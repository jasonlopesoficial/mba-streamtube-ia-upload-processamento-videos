# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 2/15 completed

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
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.4 — VideosRepository e geração de slug único
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.5 — Módulos de infraestrutura compartilhados e produtor da fila `video-processing`
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.6 — Endpoint POST /videos: pré-cadastro como rascunho e abertura do multipart
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Endpoints de partes do upload: assinatura de URLs e listagem para retomada
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — Endpoint POST /videos/{slug}/upload/complete: conclusão do upload e enfileiramento
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — MediaProbeService: extração de metadados e captura de frame com FFmpeg
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Worker de vídeo: consumidor da fila, processamento e serviço `video-worker` no Compose
- **Status:** pending
- **Tests:** —
- **Observations:** none

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
