# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 10/15 completed

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis no Compose
- **Status:** completed
- **Tests:** 9/9 passing (env.validation.integration-spec.ts); app.e2e-spec 1/1
- **Observations:**
  - minio/minio is no longer pullable (Docker Hub repo gone, quay.io requires auth); used cgr.dev/chainguard/minio:latest (MinIO built from source, ships mc for the healthcheck) and recorded a Revision on phase-03-videos/TD-04.
  - Joi bounds added beyond the plan text for safety: VIDEO_UPLOAD_PART_SIZE_BYTES max 5 GiB (S3 part limit), S3_PRESIGN_EXPIRATION_SECONDS min 60.

### SI-03.2 — StorageModule: cliente S3 para MinIO, multipart pré-assinado e leitura por range
- **Status:** completed
- **Tests:** 7/7 passing (storage.service.integration-spec.ts: 6, storage.module.spec.ts: 1)
- **Observations:**
  - Integration spec uses a dedicated random bucket (S3_BUCKET overridden before module compile) and deletes it in afterAll, so it never touches the dev bucket.
  - Added src/storage/storage.types.ts for the service's return shapes (CompletedPart, StoredPart, ObjectHead, ObjectStream).

### SI-03.3 — Entidade Video, migration CreateVideos e VideosModule
- **Status:** completed
- **Tests:** 10/10 passing (video.entity.integration-spec.ts: 6, migrations.integration-spec.ts: 3, videos.module.spec.ts: 1); full unit+integration suite 164/164
- **Observations:**
  - Channel now has @OneToMany videos, so every test DataSource that loads Channel must also register Video; added Video to the ALL_ENTITIES arrays of the 10 existing auth/users/channels specs.
  - videos.module.spec.ts overrides the Video repository instead of opening a DB connection, keeping the *.spec.ts suffix honest (CLAUDE.md test-type rule).
  - Migration spec now also asserts the CreateVideos revert step before the auth-tokens revert.

### SI-03.4 — VideosRepository e geração de slug único
- **Status:** completed
- **Tests:** 8/8 passing (slug.util.spec.ts: 2, videos.repository.integration-spec.ts: 6)
- **Observations:**
  - isUniqueViolationOn lives in src/common/database/pg-errors.ts; ChannelsService keeps its own private copy (Phase 02 code untouched) — consolidating it is a follow-up outside this phase's scope.

### SI-03.5 — Módulos de infraestrutura compartilhados e produtor da fila `video-processing`
- **Status:** completed
- **Tests:** 5/5 passing (video-processing.producer.integration-spec.ts: 3, queue.module.spec.ts: 1, videos.module.spec.ts: 1); auth E2E 52/52 after AppModule refactor
- **Observations:**
  - @nestjs/bullmq@12 is ESM-only and fails under the CommonJS Jest runtime ('Unexpected token export'); switched to @nestjs/bullmq@^11.0.5 (CJS, supports bullmq ^6 and Nest 11) and added ioredis@^5 (optional peer of bullmq 6). Recorded as a Revision on phase-03-videos/TD-01 and in library-refs.md.
  - VideosModule now registers the queue, so DB-focused specs that import it (videos.repository.integration-spec.ts) override the queue token.

### SI-03.6 — Endpoint POST /videos: pré-cadastro como rascunho e abertura do multipart
- **Status:** completed
- **Tests:** 13 passing (videos.service.spec.ts: 5, videos.service.integration-spec.ts: 1, channels.service.integration-spec.ts: +2 findByUserId, videos.module.spec.ts: 1) + spec-derived E2E test/videos-create.e2e-spec.ts 4/4
- **Observations:**
  - VideosController carries @SkipThrottle() — the ThrottlerGuard is registered as a global APP_GUARD by AuthModule, and the inherited convention (phase-02-auth/TD-08, AppController) scopes rate limiting to auth routes; without it ranged stream requests would hit 429.
  - autoLoadEntities only registers entities declared via forFeature: Channel relates to User, so contexts without AuthModule (integration specs, later the worker) must import UsersModule.
  - Repository/producer integration specs now build minimal modules (forFeature + provider) instead of importing the growing VideosModule.
  - Added test/helpers/app.ts (main.ts globals + register/confirm/login) shared by the phase's E2E suites.

### SI-03.7 — Endpoints de partes do upload: assinatura de URLs e listagem para retomada
- **Status:** completed
- **Tests:** 14 passing (videos.service.spec.ts: 11 total, +6; videos.service.integration-spec.ts: 2 total, +1) + spec-derived E2E test/videos-upload-parts.e2e-spec.ts 5/5
- **Observations:**
  - findOwnedDraft also requires upload_id to be present (a draft without an open multipart upload is treated as INVALID_VIDEO_STATE).
  - VideosService injects storageConfig to report expires_in_seconds = S3_PRESIGN_EXPIRATION_SECONDS.

### SI-03.8 — Endpoint POST /videos/{slug}/upload/complete: conclusão do upload e enfileiramento
- **Status:** completed
- **Tests:** 19 passing in videos.service.spec.ts + videos.service.integration-spec.ts (+5 unit, +1 integration) + spec-derived E2E test/videos-upload-complete.e2e-spec.ts 5/5
- **Observations:**
  - test/helpers/video-upload.ts (planned for SI-03.14) was created here because every remaining E2E needs a real direct-to-MinIO upload; SI-03.14 reuses it.
  - If enqueueing fails after the draft→processing transition, the video is moved to failed with processing_error and the error propagates (no silent stuck processing).

### SI-03.9 — MediaProbeService: extração de metadados e captura de frame com FFmpeg
- **Status:** completed
- **Tests:** 9/9 passing (media-probe.parser.spec.ts: 5, media-probe.service.integration-spec.ts: 4)
- **Observations:**
  - The integration spec probes the sample both from disk and from a presigned MinIO GET URL; both give identical results, confirming FFmpeg reads over HTTP without a full download step.
  - Container FFmpeg is Debian 5.1.x (bookworm), from Dockerfile.dev.

### SI-03.10 — Worker de vídeo: consumidor da fila, processamento e serviço `video-worker` no Compose
- **Status:** completed
- **Tests:** 7/7 passing (video-processing.service.integration-spec.ts: 4, video-processing.processor.integration-spec.ts: 2, worker.module.spec.ts: 1); Compose smoke: an upload completed through the in-process API with the default queue prefix was processed by the video-worker container to ready (duration 3 s, thumbnail stored)
- **Observations:**
  - start:worker:dev runs 'node --watch -r ts-node/register src/worker.ts' instead of 'nest start --watch --entryFile worker': both containers share the bind mount and nest-cli uses deleteOutDir, so two nest watchers would wipe each other's dist/.
  - Worker concurrency is applied in onApplicationBootstrap (worker.concurrency = VIDEO_WORKER_CONCURRENCY) because @Processor options are static.
  - On this machine 'docker compose build' asks for '--allow=fs.read=<context>' (Buildx Bake entitlement check; the project path contains non-ASCII 'Graduação'); BUILDX_BAKE_ENTITLEMENTS_FS=0 bypasses it. Documented in nestjs-project/CLAUDE.md troubleshooting.
  - Added src/test/video-fixtures.ts (channel owner + stored video row) shared by worker and delivery specs.

### SI-03.11 — Endpoint GET /videos/{slug}: consulta do vídeo e do status pelo dono
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Endpoint GET /videos/{slug}/stream: streaming com Range e 206 Partial Content
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.13 — Endpoints GET /videos/{slug}/download e /thumbnail
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.14 — Pipeline completo em E2E: upload direto → fila → worker → streaming e download
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.15 — Documentação: CLAUDE.md, arquitetura e contrato OpenAPI
- **Status:** pending
- **Tests:** —
- **Observations:** none
