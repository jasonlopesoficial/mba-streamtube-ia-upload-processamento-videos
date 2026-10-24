---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-23T18:05:48-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-23T18:05:47-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T18:03:52-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-10-23T16:24:49-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-10-23T16:24:49-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-23T16:24:49-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar upload de vídeos de até 10GB direto ao object storage (MinIO/S3) sem passar bytes pela API, com pré-cadastro automático do vídeo como rascunho, processamento automático em segundo plano (fila BullMQ + worker FFmpeg) para extrair duração/metadados e gerar thumbnail, URL única por vídeo, reprodução via streaming e download — tudo rodando localmente via Docker Compose.

---

## Step Implementations

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis no Compose

**Description:** Instala as bibliotecas da fase, cria os namespaces de configuração `storage`, `queue` e `videos`, estende o schema Joi e adiciona MinIO, Redis e FFmpeg ao ambiente Docker — fundação para todos os SIs seguintes.

**Technical actions:**

1. Instalar em `nestjs-project`: `@nestjs/bullmq@^12.0.0`, `bullmq@^6.4.0`, `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`)
2. Criar `src/config/storage.config.ts` (`registerAs('storage')`: `endpoint` ← `S3_ENDPOINT`, `publicEndpoint` ← `S3_PUBLIC_ENDPOINT` (fallback `S3_ENDPOINT`), `region` ← `S3_REGION`, `accessKey` ← `S3_ACCESS_KEY`, `secretKey` ← `S3_SECRET_KEY`, `bucket` ← `S3_BUCKET`, `presignExpirationSeconds` ← `S3_PRESIGN_EXPIRATION_SECONDS`), `src/config/queue.config.ts` (`registerAs('queue')`: `redisHost` ← `REDIS_HOST`, `redisPort` ← `REDIS_PORT`, `prefix` ← `QUEUE_PREFIX`) e `src/config/videos.config.ts` (`registerAs('videos')`: `maxSizeBytes`, `uploadPartSizeBytes`, `processingAttempts`, `processingBackoffMs`, `workerConcurrency`, `probeTimeoutMs`); registrar os três no `load` do `ConfigModule` (inherited `phase-01-configuracao-base/TD-03`)
3. Estender `src/config/env.validation.ts` e `.env.example`: `S3_ENDPOINT` (default `http://minio:9000`), `S3_PUBLIC_ENDPOINT` (optional), `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY` e `S3_SECRET_KEY` (required), `S3_BUCKET` (default `streamtube`), `S3_PRESIGN_EXPIRATION_SECONDS` (default 3600), `REDIS_HOST` (default `redis`), `REDIS_PORT` (default 6379), `QUEUE_PREFIX` (default `streamtube`), `VIDEO_MAX_SIZE_BYTES` (default 10737418240), `VIDEO_UPLOAD_PART_SIZE_BYTES` (default 67108864, min 5242880), `VIDEO_PROCESSING_ATTEMPTS` (default 3), `VIDEO_PROCESSING_BACKOFF_MS` (default 5000), `VIDEO_WORKER_CONCURRENCY` (default 1), `VIDEO_PROBE_TIMEOUT_MS` (default 120000) (per `phase-03-videos/TD-10`, ICC-2 resolution)
4. Atualizar `Dockerfile.dev` para instalar o pacote Debian `ffmpeg` (binários `ffprobe`/`ffmpeg`) (per `phase-03-videos/TD-06`)
5. Adicionar ao `compose.yaml` os serviços `minio` (`minio/minio`, `server /data --console-address :9001`, portas 9000/9001, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` a partir de `S3_ACCESS_KEY`/`S3_SECRET_KEY`, volume nomeado, healthcheck) e `redis` (`redis:7-alpine`, porta 6379, volume nomeado, healthcheck `redis-cli ping`); `nestjs-api` passa a depender de ambos `service_healthy` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: required S3 credentials, defaults, part-size lower bound | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `db`, `mailpit`, `minio`, `redis` e `nestjs-api`; `docker compose ps` mostra `minio` e `redis` como `healthy`
- `docker compose exec nestjs-api ffprobe -version` retorna a versão do FFmpeg
- Iniciar a aplicação sem `S3_ACCESS_KEY` falha na validação Joi no bootstrap
- `VIDEO_UPLOAD_PART_SIZE_BYTES` abaixo de 5242880 é rejeitado pela validação Joi
- O E2E existente `GET /` continua retornando 200 com as novas variáveis definidas

---

### SI-03.2 — StorageModule: cliente S3 para MinIO, multipart pré-assinado e leitura por range

**Description:** Encapsula todo acesso ao object storage num `StorageService` reutilizável pela API e pelo worker, usando o AWS SDK v3 apontado para o MinIO local.

**Technical actions:**

1. Criar `src/storage/storage.constants.ts` (tokens `S3_CLIENT` / `S3_PRESIGN_CLIENT`, builders `videoSourceKey(videoId)` → `videos/{videoId}/source` e `thumbnailKey(videoId)` → `thumbnails/{videoId}.jpg`) e `src/storage/storage.module.ts` com dois providers `S3Client` via `useFactory` + `inject: [storageConfig.KEY]` — interno (`endpoint`) e de presign (`publicEndpoint`) — ambos com `forcePathStyle: true` e `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-04`, library-refs § AWS SDK)
2. Criar `src/storage/storage.service.ts` com `onModuleInit` que garante o bucket (`HeadBucket` → `CreateBucket` quando ausente) (per `phase-03-videos/TD-04`)
3. Implementar no `StorageService` o ciclo multipart: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber)` (cliente de presign, `expiresIn` = `presignExpirationSeconds`), `listParts(key, uploadId)`, `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)`; rejeições do storage na conclusão (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`, `NoSuchUpload`) viram `StorageUploadRejectedError` em `src/storage/storage.errors.ts` (per `phase-03-videos/TD-02`)
4. Implementar leitura/escrita de objetos: `headObject(key)` → `{ sizeBytes, contentType }`, `getObjectStream(key, range?)` → `{ body: Readable, contentLength, contentRange }`, `putObject(key, body, contentType)`, `deleteObject(key)` e `presignGetObject(key)` (cliente interno — usado pelo worker para o FFmpeg) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-08`)
5. Atualizar `.claude/skills/testing-guide-nestjs-project/references/external-systems.md` § Object Storage: MinIO real no Compose em dev e testes, sem adapter de filesystem (ICC-1 resolution, per `phase-03-videos/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: real MinIO — multipart de 2 partes via URLs pré-assinadas (`fetch PUT`), `listParts`, conclusão, `headObject`, leitura por range, ETag inválido → `StorageUploadRejectedError`, `putObject`/`deleteObject` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: module compilation | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — config `storage` e serviço `minio`

**Acceptance criteria:**

- Inicializar o módulo com o bucket inexistente cria o bucket `S3_BUCKET` no MinIO
- Duas partes enviadas por `PUT` às URLs pré-assinadas aparecem em `listParts` com seus ETags e, após `completeMultipartUpload`, `headObject` retorna o tamanho total
- As URLs de `presignUploadPart` usam o host de `S3_PUBLIC_ENDPOINT`
- `getObjectStream(key, 'bytes=0-9')` devolve exatamente os 10 primeiros bytes e `contentRange` `bytes 0-9/{size}`
- Concluir com um ETag inválido lança `StorageUploadRejectedError`

---

### SI-03.3 — Entidade Video, migration CreateVideos e VideosModule

**Description:** Cria a tabela `videos` ligada ao canal, com o ciclo de status da fase, e o módulo de domínio que a possui.

**Technical actions:**

1. Criar `src/videos/videos.constants.ts` (enum `VideoStatus` = `draft | processing | ready | failed`, `as const` constants) e `src/videos/entities/video.entity.ts` — `@Entity('videos')` com os campos, tipos, transformers numéricos (`size_bytes`, `duration_seconds`) e índices do `### Data Model → Video` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-07`, `phase-03-videos/TD-09`)
2. Adicionar `@OneToMany(() => Video, (video) => video.channel) videos: Video[]` em `src/channels/entities/channel.entity.ts`
3. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e registrá-lo em `AppModule`
4. Gerar `src/database/migrations/<timestamp>-CreateVideos.ts` via `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar (enum `videos_status_enum`, FK `ON DELETE CASCADE`, unique `slug`, índice `channel_id`); incluir `DELETE FROM "videos"` antes de `channels` em `cleanAllTables` (`src/test/create-test-data-source.ts`)
5. Estender `src/database/migrations.integration-spec.ts`: 3 migrations aplicadas, tabela `videos` em `MANAGED_TABLES`, `videos_status_enum` em `MANAGED_ENUM_TYPES`; o revert remove `videos`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique `slug`, default `status = draft`, enum rejeita valor inválido, FK cascade ao remover canal, transformers devolvem `number` | `src/videos/entities/video.entity.integration-spec.ts` |
| Migrations | Integration: apply/revert com `CreateVideos` | `src/database/migrations.integration-spec.ts` |
| `VideosModule` | Unit: module compilation | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.1 — dependências e Compose atualizados

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com as colunas, a FK para `channels`, o unique em `slug` e o índice em `channel_id`
- Inserir dois vídeos com o mesmo `slug` falha com violação de unicidade
- Um vídeo recém-inserido sem `status` explícito fica `draft`; inserir `status = 'published'` é rejeitado pelo enum
- Remover um canal remove em cascata seus vídeos
- `size_bytes` e `duration_seconds` são lidos como `number`

---

### SI-03.4 — VideosRepository e geração de slug único

**Description:** Centraliza o acesso à tabela `videos` num repositório (inserção com retry de slug e transições de status condicionais), base para a API e o worker.

**Technical actions:**

1. Criar `src/videos/slug.util.ts` — `generateVideoSlug()`: `crypto.randomBytes(8).toString('base64url').slice(0, 11)` (per `phase-03-videos/TD-07`)
2. Criar `src/common/database/pg-errors.ts` — `isUniqueViolationOn(err, column)` (SQLSTATE `23505` + `detail` citando a coluna), padrão herdado de `phase-02-auth/TD-10`
3. Criar `src/videos/videos.repository.ts` (`@Injectable`, `@InjectRepository(Video)`): `createDraft(data)` gera o slug e repete até 5 vezes em violação de unicidade de `slug` (outras violações propagam); `findBySlugWithChannel(slug)`; `findById(id)` (per `phase-03-videos/TD-07`)
4. Implementar `transitionStatus(id, from, to, changes)` — `UPDATE … WHERE id = :id AND status = :from`, retorna `true` somente quando 1 linha foi afetada (per `phase-03-videos/TD-09`, `### Data Model → Status transitions`)
5. Registrar `VideosRepository` em `providers` e `exports` de `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generateVideoSlug` | Unit: 11 caracteres do alfabeto base64url, valores distintos em chamadas sucessivas | `src/videos/slug.util.spec.ts` |
| `VideosRepository` | Integration: retry em colisão de slug (gerador forçado a repetir), falha após esgotar tentativas, `transitionStatus` só aplica a partir do status esperado | `src/videos/videos.repository.integration-spec.ts` |

**Dependencies:** SI-03.3 — entidade `Video` e tabela `videos`

**Acceptance criteria:**

- `createDraft` persiste um vídeo `draft` com slug de 11 caracteres `[A-Za-z0-9_-]`
- Quando o primeiro slug gerado já existe, `createDraft` persiste com um novo slug sem erro
- Quando todas as tentativas colidem, `createDraft` lança erro em vez de sobrescrever
- `transitionStatus(id, 'draft', 'processing')` em um vídeo `ready` retorna `false` e não altera a linha

---

### SI-03.5 — Módulos de infraestrutura compartilhados e produtor da fila `video-processing`

**Description:** Extrai config e banco para módulos reutilizáveis pela API e pelo worker, conecta o BullMQ ao Redis e cria o produtor do job `process-video`.

**Technical actions:**

1. Extrair `ConfigModule.forRoot(...)` (todos os namespaces + Joi) para `src/config/app-config.module.ts` (`AppConfigModule`) e `TypeOrmModule.forRootAsync(...)` para `src/database/database.module.ts` (`DatabaseModule`), mantendo exatamente as opções atuais (inherited conventions phase 01); `AppModule` passa a importá-los
2. Criar `src/queue/queue.module.ts` (`QueueModule`) com `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: → { connection: { host, port }, prefix } })` e importá-lo em `AppModule` (per `phase-03-videos/TD-01`, library-refs § @nestjs/bullmq)
3. Criar `src/video-processing/video-processing.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process-video'`, `interface VideoProcessingJobData { videoId: string }` (contrato de `### Events/Messages → process-video`)
4. Criar `src/videos/video-processing.producer.ts` — `enqueue(videoId)` via `@InjectQueue(VIDEO_PROCESSING_QUEUE)` com `jobId: videoId`, `attempts`, backoff exponencial, `removeOnComplete: true`, `removeOnFail: 1000` lidos de `videosConfig`; registrar `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` e o produtor em `VideosModule` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-09`)
5. Criar `src/test/queue.ts` — helper que define um `QUEUE_PREFIX` exclusivo de teste e faz `obliterate` da fila no teardown (per `phase-03-videos/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration: real Redis — job `process-video` em `waiting` com `jobId = videoId`, `attempts`/`backoff` configurados; segundo `enqueue` do mesmo vídeo não duplica | `src/videos/video-processing.producer.integration-spec.ts` |
| `QueueModule` | Unit: module compilation | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.3 — `VideosModule` existe

**Acceptance criteria:**

- A aplicação sobe com `AppConfigModule`, `DatabaseModule` e `QueueModule` e os E2E existentes de auth continuam passando
- `enqueue(videoId)` cria no Redis um job `process-video` com payload `{ "videoId": "<uuid>" }` e `jobId` igual ao `videoId`
- Chamar `enqueue` duas vezes para o mesmo vídeo mantém um único job na fila
- Jobs criados com `QUEUE_PREFIX` de teste não aparecem sob o prefixo padrão `streamtube`

---

### SI-03.6 — Endpoint POST /videos: pré-cadastro como rascunho e abertura do multipart

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated (per `### Authorization Matrix`)

**Description:** Inicia o upload: cria o vídeo `draft` no canal do usuário e abre o multipart no MinIO, devolvendo o plano de partes — nenhum byte do arquivo passa pela API.

**Technical actions:**

1. Adicionar `findByUserId(userId): Promise<Channel | null>` em `ChannelsService`; `VideosModule` importa `ChannelsModule` e `StorageModule`
2. Criar `src/videos/dto/create-video.dto.ts` (regras de `#### Validation Rules — Videos`), `src/videos/dto/video-response.dto.ts` (`VideoResponse`, com `@ApiProperty` e `static fromEntity(video)` que monta `thumbnail_url`/`stream_url`/`download_url` só quando `ready`) e `src/videos/dto/create-video-response.dto.ts` (`{ video, upload: { part_size, part_count } }`)
3. Adicionar `ChannelNotFoundException` (`CHANNEL_NOT_FOUND`, 404) e `VideoTooLargeException` (`VIDEO_TOO_LARGE`, 400) em `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)
4. Criar `src/videos/videos.service.ts` — `initiateUpload(userId, dto)`: valida `size_bytes ≤ maxSizeBytes`, resolve o canal, gera `id` (`crypto.randomUUID()`) e `storage_key = videoSourceKey(id)`, chama `createMultipartUpload`, persiste via `VideosRepository.createDraft` (com `upload_id`); se a persistência falhar, aborta o multipart e relança o erro; calcula `part_count = ceil(size_bytes / uploadPartSizeBytes)` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-09`, `phase-03-videos/TD-10`, AMB-3 resolution)
5. Criar `src/videos/videos.controller.ts` (`@ApiTags('videos')`, `@Controller('videos')`) com `POST /videos` → 201, `@ApiBearerAuth('access-token')`, `@ApiOperation` e `@ApiResponse` para 201/400/401/404 referenciando `ApiErrorEnvelope` (per `### API Contracts → POST /videos`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.initiateUpload` | Unit: `VIDEO_TOO_LARGE`, `CHANNEL_NOT_FOUND`, aborta multipart quando a persistência falha, cálculo de `part_count` | `src/videos/videos.service.spec.ts` |
| `VideosService.initiateUpload` | Integration: real DB + MinIO — vídeo `draft` persistido com `upload_id`, multipart aberto (`listParts` vazio) | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário e `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — `StorageService`; SI-03.4 — `VideosRepository`

**Acceptance criteria:**

- `POST /videos` autenticado com `{ title, file_name, content_type: "video/mp4", size_bytes: 10737418240 }` retorna `201` com `video.status = "draft"`, `video.slug` de 11 caracteres e `upload: { part_size: 67108864, part_count: 160 }`
- `POST /videos` com `size_bytes` acima de `VIDEO_MAX_SIZE_BYTES` retorna `400` com `error: "VIDEO_TOO_LARGE"` e nenhum vídeo é persistido
- `POST /videos` com `content_type: "image/png"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` sem token retorna `401`
- Após o `201`, a linha em `videos` pertence ao canal do usuário e tem `upload_id` não nulo

---

### SI-03.7 — Endpoints de partes do upload: assinatura de URLs e listagem para retomada

**Route:** POST /videos/{slug}/upload/parts · GET /videos/{slug}/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** Owner (per `### Authorization Matrix`)

**Description:** Entrega ao dono do vídeo URLs pré-assinadas por parte e a lista de partes já enviadas, permitindo upload direto ao MinIO e retomada após falha de conexão.

**Technical actions:**

1. Adicionar `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `InvalidVideoStateException` (`INVALID_VIDEO_STATE`, 409) e `InvalidPartNumberException` (`INVALID_PART_NUMBER`, 400) em `src/common/exceptions/domain.exception.ts`
2. Em `VideosService`, criar o helper privado `findOwnedDraft(slug, userId)` — `VIDEO_NOT_FOUND` para slug inexistente ou de outro canal, `INVALID_VIDEO_STATE` quando não `draft` (per `### Authorization Matrix`)
3. Implementar `signUploadParts(slug, userId, partNumbers)` — rejeita números > `part_count` com `INVALID_PART_NUMBER`; retorna `{ parts: [{ part_number, url }], expires_in_seconds }` via `presignUploadPart` (per `phase-03-videos/TD-02`)
4. Implementar `listUploadedParts(slug, userId)` via `StorageService.listParts` → `{ parts: [{ part_number, etag, size_bytes }] }` ordenado (per `phase-03-videos/TD-02`)
5. Criar `src/videos/dto/sign-upload-parts.dto.ts` (+ DTOs de resposta) e os handlers `POST /videos/:slug/upload/parts` (200, `@HttpCode(HttpStatus.OK)`) e `GET /videos/:slug/upload/parts` (200) com decorators OpenAPI completos (per `### API Contracts`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.signUploadParts` / `listUploadedParts` | Unit: `VIDEO_NOT_FOUND` (outro canal), `INVALID_VIDEO_STATE`, `INVALID_PART_NUMBER` | `src/videos/videos.service.spec.ts` |
| `VideosService.signUploadParts` / `listUploadedParts` | Integration: real MinIO — `PUT` na URL assinada armazena a parte e `listUploadedParts` a devolve com ETag | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 — `VideosService`, `VideosController` e vídeo `draft`

**Acceptance criteria:**

- `POST /videos/{slug}/upload/parts` do dono com `{ part_numbers: [1, 2] }` retorna `200` com duas URLs e `expires_in_seconds: 3600`
- Um `PUT` com bytes na URL da parte 1 responde `200` com cabeçalho `ETag`, e `GET /videos/{slug}/upload/parts` passa a retornar `[{ part_number: 1, etag, size_bytes }]`
- `POST /videos/{slug}/upload/parts` com número maior que `part_count` retorna `400` com `error: "INVALID_PART_NUMBER"`
- Outro usuário autenticado chamando qualquer dos dois endpoints recebe `404` com `error: "VIDEO_NOT_FOUND"`
- Os dois endpoints em um vídeo que não está `draft` retornam `409` com `error: "INVALID_VIDEO_STATE"`

---

### SI-03.8 — Endpoint POST /videos/{slug}/upload/complete: conclusão do upload e enfileiramento

**Route:** POST /videos/{slug}/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner (per `### Authorization Matrix`)

**Description:** Fecha o multipart, confere o tamanho armazenado, move o vídeo para `processing` e dispara o processamento automático na fila.

**Technical actions:**

1. Adicionar `UploadIncompleteException` (`UPLOAD_INCOMPLETE`, 400) e `UploadSizeMismatchException` (`UPLOAD_SIZE_MISMATCH`, 422) em `src/common/exceptions/domain.exception.ts`
2. Criar `src/videos/dto/complete-upload.dto.ts` com validação aninhada (`@ValidateNested`, `@Type`) de `parts: [{ part_number, etag }]` (per `#### Validation Rules — Videos`)
3. Implementar `VideosService.completeUpload(slug, userId, parts)`: `findOwnedDraft`; `completeMultipartUpload` (`StorageUploadRejectedError` → `UPLOAD_INCOMPLETE`); `headObject` — tamanho ≠ `size_bytes` ⇒ `deleteObject` + `transitionStatus(draft → failed, processing_error)` + `UPLOAD_SIZE_MISMATCH` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-10`)
4. Na mesma operação: `transitionStatus(draft → processing, { upload_id: null })` (transição perdida ⇒ `INVALID_VIDEO_STATE`) e `VideoProcessingProducer.enqueue(id)`; se o enfileiramento falhar, `transitionStatus(processing → failed, processing_error)` e relança (per `phase-03-videos/TD-01`, `phase-03-videos/TD-09`)
5. Adicionar o handler `POST /videos/:slug/upload/complete` com `@HttpCode(HttpStatus.ACCEPTED)` e decorators OpenAPI para 202/400/401/404/409/422

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: `UPLOAD_INCOMPLETE`, `UPLOAD_SIZE_MISMATCH` (deleta objeto + `failed`), transição perdida, falha no enqueue → `failed` | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration: real DB + MinIO + Redis — vídeo `processing`, `upload_id` nulo, objeto em `videos/{id}/source`, job `process-video` enfileirado | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — `VideoProcessingProducer`; SI-03.7 — `findOwnedDraft` e upload de partes

**Acceptance criteria:**

- `POST /videos/{slug}/upload/complete` com todas as partes e ETags corretos retorna `202` com `status: "processing"`, e um job `process-video` com `{ "videoId": "<id>" }` fica na fila
- `POST /videos/{slug}/upload/complete` com ETag incorreto retorna `400` com `error: "UPLOAD_INCOMPLETE"` e o vídeo continua `draft`
- Concluir um upload cujo tamanho real difere de `size_bytes` retorna `422` com `error: "UPLOAD_SIZE_MISMATCH"`, o vídeo fica `failed` com `processing_error` preenchido e o objeto é removido do bucket
- Repetir `POST /videos/{slug}/upload/complete` num vídeo já `processing` retorna `409` com `error: "INVALID_VIDEO_STATE"`
- Outro usuário autenticado recebe `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.9 — MediaProbeService: extração de metadados e captura de frame com FFmpeg

**Description:** Isola a execução de `ffprobe`/`ffmpeg` (binários do sistema) num serviço testável que lê o vídeo por URL HTTP, sem baixar o arquivo inteiro.

**Technical actions:**

1. Criar `src/video-processing/media-probe.parser.ts` — `parseProbeOutput(json)` → `{ durationSeconds, metadata: { format_name, bit_rate, width, height, video_codec, audio_codec } }`; ausência de stream de vídeo ou de duração ⇒ `MediaProbeError` (per `phase-03-videos/TD-06`)
2. Criar `src/video-processing/media-probe.errors.ts` (`MediaProbeError`) e `src/video-processing/media-probe.service.ts` — `probe(input)` via `spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input])`, com timeout `probeTimeoutMs` (kill + erro) e exit code ≠ 0 ⇒ `MediaProbeError` com o stderr (per library-refs § ffmpeg)
3. Implementar `captureFrame(input, atSeconds)` → `Buffer` JPEG via `ffmpeg -v error -ss <t> -i <input> -frames:v 1 -vf scale=1280:-2 -f image2 -c:v mjpeg pipe:1`; saída vazia ⇒ `MediaProbeError` (per `phase-03-videos/TD-06`)
4. Criar `src/test/sample-video.ts` — gera um MP4 curto (`testsrc` + `sine`, `+faststart`) em diretório temporário para os testes (per `phase-03-videos/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseProbeOutput` | Unit: duração e metadados de saída válida; sem stream de vídeo/sem duração ⇒ `MediaProbeError` | `src/video-processing/media-probe.parser.spec.ts` |
| `MediaProbeService` | Integration: real FFmpeg — probe/frame de arquivo local e de URL pré-assinada do MinIO; arquivo inválido ⇒ `MediaProbeError` | `src/video-processing/media-probe.service.integration-spec.ts` |

**Dependencies:** SI-03.1 — FFmpeg na imagem; SI-03.2 — `presignGetObject` para o caso via URL

**Acceptance criteria:**

- `probe` de um MP4 de 3 s gerado com `testsrc` retorna `durationSeconds` ≈ 3, `width: 320`, `height: 240`, `video_codec: "h264"`
- `probe` aplicado à URL pré-assinada do mesmo arquivo no MinIO retorna os mesmos metadados
- `captureFrame(input, 1)` retorna bytes iniciados pela assinatura JPEG `FF D8 FF`
- `probe` de um arquivo com bytes aleatórios lança `MediaProbeError`

---

### SI-03.10 — Worker de vídeo: consumidor da fila, processamento e serviço `video-worker` no Compose

**Description:** Implementa o consumidor `process-video` que extrai duração/metadados, gera a thumbnail e fecha o ciclo de status, rodando como processo e container separados da API.

**Technical actions:**

1. Criar `src/video-processing/video-processing.service.ts` — `process(videoId)`: carrega o vídeo; se não estiver `processing`, encerra sem efeito (idempotência); `presignGetObject(storage_key)` → `probe` → `captureFrame` em 10% da duração (0 s quando < 1 s) → `putObject(thumbnailKey(id), jpeg, 'image/jpeg')` → `transitionStatus(processing → ready, { duration_seconds, metadata, thumbnail_key, processed_at })`; `MediaProbeError` ⇒ `UnrecoverableError`. `markFailed(videoId, reason)` → `transitionStatus(processing → failed, { processing_error, processed_at })` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-09`)
2. Criar `src/video-processing/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` + `WorkerHost`: `process(job)` delega ao serviço; `@OnWorkerEvent('failed')` chama `markFailed` quando `UnrecoverableError` ou `attemptsMade >= opts.attempts`, registrando o erro via `Logger` (contexto background — sem rethrow); concorrência do worker = `workerConcurrency` (per `phase-03-videos/TD-01`, library-refs § @nestjs/bullmq)
3. Criar `src/video-processing/video-processing.module.ts` (imports `VideosModule`, `StorageModule`, `BullModule.registerQueue`; providers serviço, processor, `MediaProbeService`), `src/worker.module.ts` (`AppConfigModule`, `DatabaseModule`, `QueueModule`, `VideoProcessingModule`) e `src/worker.ts` (`NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()`) (per `phase-03-videos/TD-05`)
4. Adicionar scripts `start:worker` (`node dist/worker`) e `start:worker:dev` (`nest start --watch --entryFile worker`) em `package.json`
5. Adicionar o serviço `video-worker` ao `compose.yaml` — mesma imagem/volume do `nestjs-api`, `command: npm run start:worker:dev`, `restart: unless-stopped`, `depends_on` `db`/`redis`/`minio` `service_healthy` (per `phase-03-videos/TD-05`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Integration: real DB + MinIO + FFmpeg — vídeo `processing` vira `ready` com duração, metadados e thumbnail JPEG no bucket; vídeo fora de `processing` não é alterado; mídia inválida ⇒ `UnrecoverableError` | `src/video-processing/video-processing.service.integration-spec.ts` |
| `VideoProcessingProcessor` | Integration: worker in-process com `QUEUE_PREFIX` isolado — job enfileirado leva o vídeo a `ready`; mídia inválida leva a `failed` com `processing_error` sem novas tentativas | `src/video-processing/video-processing.processor.integration-spec.ts` |
| `WorkerModule` | Unit: module compilation | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.5 — fila e contrato `process-video`; SI-03.8 — vídeos chegam a `processing`; SI-03.9 — `MediaProbeService`

**Acceptance criteria:**

- Um job `process-video` para um vídeo `processing` com MP4 válido leva a linha a `status = 'ready'` com `duration_seconds`, `metadata`, `thumbnail_key` e `processed_at` preenchidos, e o objeto `thumbnails/{id}.jpg` existe no bucket
- Um job para um vídeo com bytes inválidos leva a linha a `status = 'failed'` com `processing_error` preenchido, sem novas tentativas
- Entregar o mesmo job duas vezes não altera um vídeo já `ready`
- `docker compose up -d video-worker` mantém o container `running` e os logs mostram o worker conectado à fila `video-processing`
- Com a stack completa no Compose, um upload concluído pela API é processado pelo container `video-worker` até `ready` sem intervenção manual

---

### SI-03.11 — Endpoint GET /videos/{slug}: consulta do vídeo e do status pelo dono

**Route:** GET /videos/{slug}
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Owner (per `### Authorization Matrix`)

**Description:** Expõe ao dono o estado do vídeo (rascunho, processando, pronto ou erro) com metadados e links de entrega, refletindo o ciclo de status gravado no banco.

**Technical actions:**

1. Implementar `VideosService.getOwnedVideo(slug, userId)` — `VIDEO_NOT_FOUND` para slug inexistente ou de outro canal; qualquer status é visível ao dono (per `phase-03-videos/TD-09`)
2. Adicionar o handler `GET /videos/:slug` retornando `VideoResponseDto.fromEntity`, com `@ApiBearerAuth('access-token')` e `@ApiResponse` 200/401/404 (per `### API Contracts → GET /videos/{slug}`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getOwnedVideo` | Unit: dono recebe o vídeo em qualquer status; outro canal ⇒ `VIDEO_NOT_FOUND` | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.6 — `VideosController` e `VideoResponseDto`

**Acceptance criteria:**

- `GET /videos/{slug}` do dono de um vídeo `draft` retorna `200` com `status: "draft"` e `stream_url`, `download_url`, `thumbnail_url` nulos
- `GET /videos/{slug}` do dono de um vídeo `ready` retorna `200` com `duration_seconds`, `metadata` e as três URLs `/videos/{slug}/…`
- `GET /videos/{slug}` de um vídeo `failed` retorna `processing_error` preenchido
- Outro usuário autenticado recebe `404` com `error: "VIDEO_NOT_FOUND"`; sem token, `401`

---

### SI-03.12 — Endpoint GET /videos/{slug}/stream: streaming com Range e 206 Partial Content

**Route:** GET /videos/{slug}/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous (`ready` only) (per `### Authorization Matrix`)

**Description:** Permite reproduzir o vídeo sem baixá-lo inteiro, atendendo requisições `Range` com leitura parcial do MinIO repassada em stream.

**Technical actions:**

1. Criar `src/videos/range.util.ts` — `parseRangeHeader(header, sizeBytes)` → `{ start, end }` para um único range `bytes=` (`a-b`, `a-`, `-n`, `end` limitado a `size-1`), `null` para cabeçalho ausente/multi-range/malformado e `'unsatisfiable'` quando `start ≥ size` (per `phase-03-videos/TD-08`)
2. Adicionar `RangeNotSatisfiableException` (`RANGE_NOT_SATISFIABLE`, 416, `headers: { 'Content-Range': 'bytes */{size}' }`); `DomainException` ganha `headers?` opcional e `DomainExceptionFilter` aplica `exception.headers` quando presente (per `### Error Catalog`)
3. Implementar `VideosService.openStream(slug, rangeHeader)` — `findReadyVideo(slug)` (`VIDEO_NOT_FOUND` quando inexistente ou não `ready`); com range ⇒ `getObjectStream(key, 'bytes=a-b')` + `{ status: 206, headers }`; sem range ⇒ objeto inteiro + `{ status: 200, headers }` (per `phase-03-videos/TD-08`, AMB-1 resolution)
4. Adicionar o handler `@Public() GET /videos/:slug/stream` com `@Res({ passthrough: true })` definindo status e cabeçalhos (`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`) e retornando `StreamableFile` (sem buffer do arquivo); OpenAPI 200/206/404/416 sem `@ApiBearerAuth`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseRangeHeader` | Unit: `a-b`, `a-`, `-n`, `end` além do tamanho, multi-range/malformado ⇒ `null`, `start ≥ size` ⇒ `'unsatisfiable'` | `src/videos/range.util.spec.ts` |
| `DomainExceptionFilter` | Unit: aplica `headers` da exceção à resposta | `src/common/filters/domain-exception.filter.spec.ts` |
| `VideosService.openStream` | Integration: real MinIO — bytes do range batem com o arquivo original; vídeo não `ready` ⇒ `VIDEO_NOT_FOUND` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.10 — vídeos chegam a `ready`; SI-03.11 — `VideoResponseDto` com `stream_url`

**Acceptance criteria:**

- `GET /videos/{slug}/stream` anônimo com `Range: bytes=0-1023` de um vídeo `ready` retorna `206` com `Content-Range: bytes 0-1023/{size}`, `Content-Length: 1024`, `Accept-Ranges: bytes` e os 1024 primeiros bytes do arquivo
- `GET /videos/{slug}/stream` sem `Range` retorna `200` com `Content-Length` igual a `size_bytes`
- `GET /videos/{slug}/stream` com `Range: bytes={size}-` retorna `416` com `error: "RANGE_NOT_SATISFIABLE"` e `Content-Range: bytes */{size}`
- `GET /videos/{slug}/stream` de um vídeo `processing` retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.13 — Endpoints GET /videos/{slug}/download e /thumbnail

**Route:** GET /videos/{slug}/download · GET /videos/{slug}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous (`ready` only) (per `### Authorization Matrix`)

**Description:** Entrega o arquivo completo como download (com o nome original) e a thumbnail gerada pelo worker.

**Technical actions:**

1. Criar `src/videos/content-disposition.util.ts` — `buildAttachmentDisposition(filename)` → `attachment; filename="{ascii-safe}"; filename*=UTF-8''{percent-encoded}` (aspas, barras e caracteres de controle removidos do fallback ASCII) (per `### API Contracts → GET /videos/{slug}/download`)
2. Implementar `VideosService.openDownload(slug)` (objeto inteiro + `Content-Disposition`) e `openThumbnail(slug)` (`thumbnail_key`, `image/jpeg`), ambos via `findReadyVideo` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-06`)
3. Adicionar os handlers `@Public() GET /videos/:slug/download` e `@Public() GET /videos/:slug/thumbnail` retornando `StreamableFile`, com OpenAPI 200/404 sem `@ApiBearerAuth`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `buildAttachmentDisposition` | Unit: nome ASCII, nome com acentos/espaços (`filename*`), aspas e barras neutralizadas | `src/videos/content-disposition.util.spec.ts` |
| `VideosService.openDownload` / `openThumbnail` | Integration: real MinIO — corpo íntegro, cabeçalhos corretos, vídeo não `ready` ⇒ `VIDEO_NOT_FOUND` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.12 — `findReadyVideo` e padrão de resposta em stream

**Acceptance criteria:**

- `GET /videos/{slug}/download` anônimo de um vídeo `ready` retorna `200` com `Content-Disposition: attachment; filename="…"` contendo o `original_filename` e corpo idêntico ao arquivo enviado
- `GET /videos/{slug}/thumbnail` anônimo de um vídeo `ready` retorna `200` com `Content-Type: image/jpeg` e corpo iniciado por `FF D8 FF`
- Os dois endpoints para um vídeo `draft` retornam `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.14 — Pipeline completo em E2E: upload direto → fila → worker → streaming e download

**Description:** Prova ponta a ponta, com a infraestrutura real do Compose, os entregáveis da fase: upload direto ao MinIO, processamento automático pelo worker, URL única, streaming e download.

**Technical actions:**

1. Criar `test/helpers/video-upload.ts` — helper que inicia o upload via API, envia as partes por `PUT` às URLs pré-assinadas (`fetch`) e conclui com os ETags (per `phase-03-videos/TD-02`)
2. Criar `test/video-pipeline.e2e-spec.ts` — sobe `AppModule` (HTTP, com pipes/filters globais do `main.ts`) e `WorkerModule` in-process com `QUEUE_PREFIX` isolado; percorre registro/login → `POST /videos` → partes → `complete` → polling de `GET /videos/{slug}` até `ready` → `stream` (206) → `download` → `thumbnail`; inclui o caminho de mídia inválida até `failed` e dois uploads com slugs distintos (per `phase-03-videos/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Pipeline de vídeo | E2E: fluxo completo com MinIO, Redis, FFmpeg e Postgres reais | `test/video-pipeline.e2e-spec.ts` |

**Dependencies:** SI-03.13 — todos os endpoints da fase; SI-03.10 — `WorkerModule`

**Acceptance criteria:**

- Um MP4 enviado em partes direto ao MinIO chega a `status: "ready"` sem requisição adicional após o `complete`, com `duration_seconds` > 0 e `thumbnail_url` preenchida
- O `stream_url` do vídeo pronto responde `206` a um `Range` e o `download_url` devolve o arquivo idêntico ao enviado
- Um arquivo que não é vídeo, enviado e concluído com sucesso, termina em `status: "failed"` com `processing_error`
- Dois vídeos enviados pelo mesmo canal recebem slugs diferentes

---

### SI-03.15 — Documentação: CLAUDE.md, arquitetura e contrato OpenAPI

**Description:** Alinha a documentação de IA e de arquitetura ao estado real do código após a fase (módulo de vídeos, endpoints, fila/worker e storage).

**Technical actions:**

1. Atualizar `CLAUDE.md` (raiz): container Message Queue = BullMQ/Redis, worker `video-worker`, Object Storage MinIO local; seção de vídeos com o fluxo upload → processamento → entrega (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`)
2. Atualizar `nestjs-project/CLAUDE.md`: serviços `minio`/`redis`/`video-worker` e checagens de prontidão, variáveis `S3_*`/`REDIS_*`/`QUEUE_PREFIX`/`VIDEO_*`, comandos do worker, seção "Videos module" (endpoints, status, chaves de storage) e isolamento de fila nos testes (per `phase-03-videos/TD-11`)
3. Atualizar `docs/diagrams/software-arch.mermaid` — "Message Queue (TBD)" → BullMQ/Redis
4. Regenerar `nestjs-project/openapi.json` via `npm run openapi:export` (inherited `openapi-docs-nestjs/TD-02`)

**Tests:** _(empty — documentation; OpenAPI export covered by the existing `src/openapi-export.integration-spec.ts`)_

**Dependencies:** SI-03.14 — comportamento final verificado

**Acceptance criteria:**

- Todo arquivo, comando, variável e endpoint citado nos dois `CLAUDE.md` existe no código ou no `compose.yaml`
- `nestjs-project/openapi.json` contém os 8 endpoints `/videos` com seus códigos de resposta
- `docs/diagrams/software-arch.mermaid` não contém mais "TBD" para a fila

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK — generated by the service (`crypto.randomUUID()`) before insert so `storage_key` can derive from it (per `phase-03-videos/TD-04`) |
| channel_id | uuid | FK → `channels.id`, `ON DELETE CASCADE`, not null, indexed |
| slug | varchar(11) | unique, not null — random base64url, 11 chars (per `phase-03-videos/TD-07`) |
| title | varchar(100) | not null |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (per `phase-03-videos/TD-09`) |
| original_filename | varchar(255) | not null |
| content_type | varchar(100) | not null — `video/*` (per `phase-03-videos/TD-10`) |
| size_bytes | bigint | not null — declared size at upload start; mapped to `number` via column transformer |
| storage_key | varchar(255) | not null — `videos/{id}/source` (per `phase-03-videos/TD-04`) |
| upload_id | varchar(255) | nullable — S3 multipart `UploadId` while `status = draft`; cleared after completion (per `phase-03-videos/TD-02`) |
| thumbnail_key | varchar(255) | nullable — `thumbnails/{id}.jpg`, set when `ready` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`) |
| duration_seconds | numeric(10,3) | nullable — mapped to `number`; set when `ready` (per `phase-03-videos/TD-06`) |
| metadata | jsonb | nullable — `{ format_name, bit_rate, width, height, video_codec, audio_codec }` from ffprobe (per `phase-03-videos/TD-06`) |
| processing_error | text | nullable — reason stored on final failure (per `phase-03-videos/TD-09`) |
| processed_at | timestamp | nullable — set when the worker reaches `ready` or `failed` |
| created_at | timestamp | `@CreateDateColumn` |
| updated_at | timestamp | `@UpdateDateColumn` |

**Relations:** `Channel` has many `Video` (`@OneToMany(() => Video, (video) => video.channel)`); `Video` belongs to `Channel` (`@ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'channel_id' })`).
**Indexes:** unique on `slug`; index on `channel_id`.
**Status transitions:** `draft → processing` (API, upload completion) · `processing → ready` (worker) · `processing → failed` (worker, final attempt) · `draft → failed` (API, size mismatch on completion). Every transition is a conditional update (`WHERE id = :id AND status = :expected`) so concurrent or repeated deliveries cannot move a video backwards.
**Migration:** `src/database/migrations/<timestamp>-CreateVideos.ts` (generated via `npm run migration:generate`).

### API Contracts

All endpoints live in `VideosController` (`@ApiTags('videos')`, `@Controller('videos')`). `{slug}` is the public identifier from `phase-03-videos/TD-07`. Error bodies use the inherited envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`).

**`VideoResponse` shape** (reused below):

- id: string (uuid)
- slug: string (11 chars)
- title: string
- status: `"draft" | "processing" | "ready" | "failed"`
- original_filename: string
- content_type: string
- size_bytes: number
- duration_seconds: number | null
- metadata: `{ format_name: string, bit_rate: number | null, width: number | null, height: number | null, video_codec: string | null, audio_codec: string | null }` | null
- processing_error: string | null
- thumbnail_url: string | null — `/videos/{slug}/thumbnail` when `ready`, else null
- stream_url: string | null — `/videos/{slug}/stream` when `ready`, else null
- download_url: string | null — `/videos/{slug}/download` when `ready`, else null
- created_at: string (ISO-8601)
- updated_at: string (ISO-8601)

---

#### POST /videos (SI-03.6)

Pre-registers the video as `draft` and opens an S3 multipart upload (per `phase-03-videos/TD-02`, `phase-03-videos/TD-10`). No file bytes are sent to the API.

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- title: string, required — trimmed, 1–100 characters
- file_name: string, required — 1–255 characters
- content_type: string, required — matches `^video\/[a-z0-9.+-]+$`, max 100 characters
- size_bytes: integer, required — ≥ 1 and ≤ `VIDEO_MAX_SIZE_BYTES` (default 10737418240 = 10 GiB)

**Response 201:**
- video: VideoResponse (`status: "draft"`)
- upload: `{ part_size: number, part_count: number }` — `part_size = VIDEO_UPLOAD_PART_SIZE_BYTES` (default 67108864 = 64 MiB), `part_count = ceil(size_bytes / part_size)`

**Error responses:**
- 400 VALIDATION_ERROR: body fails schema validation
- 400 VIDEO_TOO_LARGE: `size_bytes` exceeds `VIDEO_MAX_SIZE_BYTES`
- 401: missing or invalid access token
- 404 CHANNEL_NOT_FOUND: authenticated user has no channel

---

#### POST /videos/{slug}/upload/parts (SI-03.7)

Returns presigned `UploadPart` URLs signed for `S3_PUBLIC_ENDPOINT` (per `phase-03-videos/TD-02`, ICC-2 resolution). Also used to resume: the client requests fresh URLs for the parts still missing.

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- part_numbers: integer[], required — 1–1000 unique items, each 1–10000

**Response 200:**
- parts: `[{ part_number: number, url: string }]` — client sends `PUT {url}` with the raw part bytes and keeps the `ETag` response header
- expires_in_seconds: number — `S3_PRESIGN_EXPIRATION_SECONDS` (default 3600)

**Error responses:**
- 400 VALIDATION_ERROR: body fails schema validation
- 400 INVALID_PART_NUMBER: a part number is greater than the video's `part_count`
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the video belongs to another channel
- 409 INVALID_VIDEO_STATE: video is not `draft`

---

#### GET /videos/{slug}/upload/parts (SI-03.7)

Lists the parts already stored for the open multipart upload (`ListParts`) so an interrupted upload can resume (per `phase-03-videos/TD-02`).

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- parts: `[{ part_number: number, etag: string, size_bytes: number }]` — ordered by `part_number`

**Error responses:**
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the video belongs to another channel
- 409 INVALID_VIDEO_STATE: video is not `draft`

---

#### POST /videos/{slug}/upload/complete (SI-03.8)

Completes the multipart upload, verifies the stored size, moves the video to `processing` and enqueues `process-video` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-09`, `phase-03-videos/TD-10`, `phase-03-videos/TD-01`).

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- parts: `[{ part_number: integer 1–10000, etag: string 1–200 }]`, required — 1–10000 items

**Response 202:** VideoResponse (`status: "processing"`)

**Error responses:**
- 400 VALIDATION_ERROR: body fails schema validation
- 400 UPLOAD_INCOMPLETE: storage rejects the completion (missing part, wrong ETag, part too small)
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the video belongs to another channel
- 409 INVALID_VIDEO_STATE: video is not `draft`
- 422 UPLOAD_SIZE_MISMATCH: stored object size differs from the declared `size_bytes` (video moves to `failed`, object is deleted)

---

#### GET /videos/{slug} (SI-03.11)

Owner view of the video, including processing status (per `phase-03-videos/TD-09`).

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:** VideoResponse

**Error responses:**
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the video belongs to another channel

---

#### GET /videos/{slug}/stream (SI-03.12)

Public streaming of a `ready` video through ranged reads (per `phase-03-videos/TD-08`, AMB-1 resolution). Single-range requests only; a `Range` header that is not a single `bytes=` range is ignored and the full body is returned.

**Request headers:**
- Range: `bytes={start}-{end}` | `bytes={start}-` | `bytes=-{suffix}` (optional)

**Response 206:** partial body — headers `Content-Type: {content_type}`, `Content-Length: {end-start+1}`, `Content-Range: bytes {start}-{end}/{size_bytes}`, `Accept-Ranges: bytes`
**Response 200:** full body (no `Range`) — headers `Content-Type`, `Content-Length: {size_bytes}`, `Accept-Ranges: bytes`

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug does not exist or the video is not `ready`
- 416 RANGE_NOT_SATISFIABLE: range starts beyond the object size — header `Content-Range: bytes */{size_bytes}`

---

#### GET /videos/{slug}/download (SI-03.13)

Public download of a `ready` video (per `phase-03-videos/TD-08`, AMB-1 resolution).

**Response 200:** full body — headers `Content-Type: {content_type}`, `Content-Length: {size_bytes}`, `Content-Disposition: attachment; filename="{ascii-safe original_filename}"; filename*=UTF-8''{percent-encoded original_filename}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug does not exist or the video is not `ready`

---

#### GET /videos/{slug}/thumbnail (SI-03.13)

Public thumbnail of a `ready` video (per `phase-03-videos/TD-06`, AMB-1 resolution).

**Response 200:** JPEG body — headers `Content-Type: image/jpeg`, `Content-Length`

**Error responses:**
- 404 VIDEO_NOT_FOUND: slug does not exist or the video is not `ready`

---

#### Validation Rules — Videos

- `title`: required string, trimmed, 1–100 characters
- `file_name`: required string, 1–255 characters
- `content_type`: required string, `^video\/[a-z0-9.+-]+$`, max 100 characters
- `size_bytes`: required integer ≥ 1; upper bound enforced by the service against `VIDEO_MAX_SIZE_BYTES` (`VIDEO_TOO_LARGE`)
- `part_numbers`: required array, 1–1000 unique integers, each 1–10000
- `parts`: required array, 1–10000 items; `part_number` integer 1–10000; `etag` non-empty string ≤ 200

### Authorization Matrix

| Endpoint | Anonymous | Authenticated (non-owner) | Owner (video's channel belongs to the user) |
|----------|-----------|---------------------------|---------------------------------------------|
| POST /videos | ✗ 401 | ✓ (creates in own channel) | ✓ |
| POST /videos/{slug}/upload/parts | ✗ 401 | ✗ 404 VIDEO_NOT_FOUND | ✓ |
| GET /videos/{slug}/upload/parts | ✗ 401 | ✗ 404 VIDEO_NOT_FOUND | ✓ |
| POST /videos/{slug}/upload/complete | ✗ 401 | ✗ 404 VIDEO_NOT_FOUND | ✓ |
| GET /videos/{slug} | ✗ 401 | ✗ 404 VIDEO_NOT_FOUND | ✓ |
| GET /videos/{slug}/stream | ✓ (`ready` only) | ✓ (`ready` only) | ✓ (`ready` only) |
| GET /videos/{slug}/download | ✓ (`ready` only) | ✓ (`ready` only) | ✓ (`ready` only) |
| GET /videos/{slug}/thumbnail | ✓ (`ready` only) | ✓ (`ready` only) | ✓ (`ready` only) |

Ownership is resolved in `VideosService` by comparing `video.channel.user_id` with the JWT `sub` (inherited `phase-02-auth/TD-02`); non-owners receive 404 so slugs of draft videos are not disclosed. Public routes use `@Public()` (inherited convention) and never carry `@ApiBearerAuth`.

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VALIDATION_ERROR | 400 | Request body fails DTO validation (inherited filter) |
| VIDEO_TOO_LARGE | 400 | `POST /videos` with `size_bytes` > `VIDEO_MAX_SIZE_BYTES` |
| INVALID_PART_NUMBER | 400 | `POST /videos/{slug}/upload/parts` with a part number > `part_count` |
| UPLOAD_INCOMPLETE | 400 | Storage rejects `CompleteMultipartUpload` (missing part, wrong ETag, part below 5 MiB) |
| CHANNEL_NOT_FOUND | 404 | Authenticated user without a channel calls `POST /videos` |
| VIDEO_NOT_FOUND | 404 | Unknown slug; video owned by another channel (owner routes); video not `ready` (public routes) |
| INVALID_VIDEO_STATE | 409 | Upload operation on a video that is not `draft` |
| RANGE_NOT_SATISFIABLE | 416 | `Range` start ≥ object size on `GET /videos/{slug}/stream` (adds `Content-Range: bytes */{size}`) |
| UPLOAD_SIZE_MISMATCH | 422 | Completed object size ≠ declared `size_bytes` (video → `failed`) |

All codes are `DomainException` subclasses in `src/common/exceptions/domain.exception.ts`, rendered by the inherited `DomainExceptionFilter`. `RangeNotSatisfiableException` carries response headers; the filter applies `exception.headers` when present.

### Events/Messages

#### process-video

**Queue:** `video-processing` (BullMQ, Redis; key prefix `QUEUE_PREFIX`, default `streamtube`)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId: videoId` (deduplication), `attempts: VIDEO_PROCESSING_ATTEMPTS` (default 3), `backoff: { type: 'exponential', delay: VIDEO_PROCESSING_BACKOFF_MS }` (default 5000), `removeOnComplete: true`, `removeOnFail: 1000`.

**Producer:** `VideoProcessingProducer` called by `VideosService.completeUpload` after the `draft → processing` transition (per `phase-03-videos/TD-01`, `phase-03-videos/TD-09`)
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing')`, `WorkerHost`) running in the `video-worker` Compose service via `src/worker.ts` (per `phase-03-videos/TD-05`)
**Trigger:** successful `POST /videos/{slug}/upload/complete`
**Processing:** load video → skip unless `status = processing` (idempotent) → presign internal GET → `ffprobe` (duration + metadata) → `ffmpeg` frame at 10% of duration → `PutObject thumbnails/{id}.jpg` → `processing → ready` (per `phase-03-videos/TD-06`)
**Failure:** unreadable media throws `UnrecoverableError` (no retry); other errors retry with backoff; on the final failed attempt the processor stores `processing_error` and moves `processing → failed` (per `phase-03-videos/TD-09`)
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-01`); consumer is idempotent through the conditional status transition

---

## Dependency Map

```
SI-03.1 (root — deps, config, MinIO/Redis/FFmpeg)
├── SI-03.2 — depends on SI-03.1 (storage config + minio service)
│   └── SI-03.6 — depends on SI-03.2 + SI-03.4 (storage + repository)
├── SI-03.3 — depends on SI-03.1 (entity needs updated stack)
│   ├── SI-03.4 — depends on SI-03.3 (repository over videos table)
│   │   └── SI-03.6 — POST /videos
│   │       ├── SI-03.7 — depends on SI-03.6 (controller + draft video)
│   │       │   └── SI-03.8 — depends on SI-03.7 + SI-03.5 (owned draft + producer)
│   │       │       └── SI-03.10 — depends on SI-03.8 + SI-03.5 + SI-03.9 (processing videos + queue + FFmpeg)
│   │       │           └── SI-03.12 — depends on SI-03.10 + SI-03.11 (ready videos + response DTO)
│   │       │               └── SI-03.13 — depends on SI-03.12 (findReadyVideo)
│   │       │                   └── SI-03.14 — depends on SI-03.13 + SI-03.10 (all endpoints + WorkerModule)
│   │       │                       └── SI-03.15 — depends on SI-03.14 (final behavior)
│   │       └── SI-03.11 — depends on SI-03.6 (controller + VideoResponseDto)
│   └── SI-03.5 — depends on SI-03.3 (VideosModule hosts the producer)
└── SI-03.9 — depends on SI-03.1 + SI-03.2 (FFmpeg + presignGetObject)
```

Execution order (topological): SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.8 → SI-03.9 → SI-03.10 → SI-03.11 → SI-03.12 → SI-03.13 → SI-03.14 → SI-03.15.

---

## Deliverables

- [ ] SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis no Compose
- [ ] SI-03.2 — StorageModule: cliente S3 para MinIO, multipart pré-assinado e leitura por range
- [ ] SI-03.3 — Entidade Video, migration CreateVideos e VideosModule
- [ ] SI-03.4 — VideosRepository e geração de slug único
- [ ] SI-03.5 — Módulos de infraestrutura compartilhados e produtor da fila `video-processing`
- [ ] SI-03.6 — Endpoint POST /videos: pré-cadastro como rascunho e abertura do multipart
- [ ] SI-03.7 — Endpoints de partes do upload: assinatura de URLs e listagem para retomada
- [ ] SI-03.8 — Endpoint POST /videos/{slug}/upload/complete: conclusão do upload e enfileiramento
- [ ] SI-03.9 — MediaProbeService: extração de metadados e captura de frame com FFmpeg
- [ ] SI-03.10 — Worker de vídeo: consumidor da fila, processamento e serviço `video-worker` no Compose
- [ ] SI-03.11 — Endpoint GET /videos/{slug}: consulta do vídeo e do status pelo dono
- [ ] SI-03.12 — Endpoint GET /videos/{slug}/stream: streaming com Range e 206 Partial Content
- [ ] SI-03.13 — Endpoints GET /videos/{slug}/download e /thumbnail
- [ ] SI-03.14 — Pipeline completo em E2E: upload direto → fila → worker → streaming e download
- [ ] SI-03.15 — Documentação: CLAUDE.md, arquitetura e contrato OpenAPI

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
- [ ] Compose stack is up (`cd nestjs-project && docker compose ps` — `db`, `mailpit`, `minio`, `redis`, `nestjs-api`, `video-worker` running; `minio`/`redis`/`db` healthy)
