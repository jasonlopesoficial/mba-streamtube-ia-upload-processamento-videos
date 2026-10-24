---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-23T16:24:23-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T07:32:07-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-10-23T16:24:49-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-10-23T16:24:49-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-23T16:24:49-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-23T16:24:49-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-23T16:24:49-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-23T16:24:23-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-24T08:02:32-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Edição de informações do vídeo, categorias, visibilidade público/unlisted, fluxo rascunho → publicação e painel do canal (Fase 04); player e página de visualização (Fase 05); interações sociais (Fase 06); qualquer tela no `next-frontend/`.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — no UI capability bullet in this phase; upload/watch screens belong to Fases 04–05.

**Sequencing notes:** Depends on Fase 01 (Compose, config, migrations) and Fase 02 (users, channels 1:1, global JWT guard, domain exception filter). Fase 04 and Fase 05 depend on this phase.

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta — provides authenticated user and the user's channel (owner of videos).
- **Phase 04:** Gerenciamento de Vídeos e Canal — owns title/description editing, visibility and publication flow ("Fluxo de rascunho → publicação").

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ on Redis) | @nestjs/bullmq@^11.0.5, bullmq@^6.4.0, ioredis@^5 |
|  └─ Last revision: 2026-10-24 — `@nestjs/bullmq` pinned to `^11.0.5` (12.x is ESM-only) and `ioredis@^5` added |  |  |  |  |  |  |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Protocol for Files up to 10GB | decided | C (Presigned S3 multipart upload) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-03 | phase | Backend | S3 Client Library | decided | A (AWS SDK v3) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-04 | phase | Backend | Bucket and Object Key Organization | decided | A (One private bucket, UUID-derived prefixes) | — |
| phase-03-videos/TD-05 | phase | Repo-wide | Video Worker Runtime | decided | A (Same codebase, separate entrypoint and Compose service) | — |
| phase-03-videos/TD-06 | phase | Backend | Metadata Extraction and Thumbnail Generation | decided | A (Direct ffprobe/ffmpeg over presigned HTTP URL) | ffmpeg (Debian package — system binaries ffprobe/ffmpeg) |
| phase-03-videos/TD-07 | phase | Cross-layer | Unique Video URL Identifier | decided | A (Random 11-char base64url slug + unique index + retry) | — |
| phase-03-videos/TD-08 | phase | Cross-layer | Video Delivery — Streaming and Download | decided | A (API proxies ranged reads — 206 Partial Content) | — |
| phase-03-videos/TD-09 | phase | Cross-layer | Video Status Lifecycle and Failure Handling | decided | A (draft → processing → ready | failed, 3 attempts with exponential backoff) | — |
| phase-03-videos/TD-10 | phase | Cross-layer | Upload Limits and Part Size Policy | decided | A (Server-defined 64 MiB parts, 10 GiB max, video/*) | — |
| phase-03-videos/TD-11 | phase | Backend | Test Strategy for Queue, Worker and Storage | decided | A (Real infrastructure, in-process worker with isolated queue prefix) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-11 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-05, phase-03-videos/TD-11 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-10 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-09 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-09, phase-03-videos/TD-11 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-06, phase-03-videos/TD-11 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-08 |
| Download do vídeo pelo usuário | phase-03-videos/TD-08 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ on Redis — it is the queue documented by NestJS itself, giving retries/backoff/deduplication as job options and a `WorkerHost` consumer that runs in a separate process with the same `ConfigModule`/`TypeOrmModule` wiring the project already uses; the cost is one Redis container, acceptable for a video platform whose processing is the heaviest workload. pg-boss would avoid Redis but loads the primary DB and has no Nest integration.

**Libraries:** `@nestjs/bullmq@^11.0.5`, `bullmq@^6.4.0`, `ioredis@^5`

**Revisions:**
- 2026-10-24 — `@nestjs/bullmq` pinned to `^11.0.5` (instead of `^12.0.0`) and `ioredis@^5` added. Rationale: `@nestjs/bullmq@12` is ESM-only and cannot be loaded by the CommonJS Jest runtime on NestJS 11; `bullmq@6` made `ioredis` an optional peer.

### phase-03-videos/TD-02

**Recommendation:** Presigned S3 multipart upload — it is the only option that keeps the API out of the data path *and* supports 10GB with resume using the storage that is already a given (MinIO/S3), with no extra service; the handshake complexity is confined to three small endpoints, and the public-vs-internal endpoint issue is handled by a dedicated public endpoint setting for presigning.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-03

**Recommendation:** AWS SDK v3 — the production target is Amazon S3, and the SDK covers presigned `UploadPart`, ranged `GetObject` and multipart completion natively; MinIO is reached with `endpoint` + `forcePathStyle: true`, so local/prod differ only in environment variables.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-04

**Recommendation:** One private bucket with UUID-derived prefixes — the phase has no requirement for different access policies, and keys based on `videoId` keep storage independent from the public slug (TD-07) and from the original filename.

**Libraries:** —

**Revisions:**
- 2026-10-24 — Local MinIO image is `cgr.dev/chainguard/minio:latest` (free `minio/minio` images are no longer published). Bucket/key layout unchanged.

### phase-03-videos/TD-05

**Recommendation:** Same codebase with a separate entrypoint and Compose service — it honors the architecture's separate container while reusing the TypeORM entity, config namespaces and storage client without introducing monorepo tooling.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Direct `ffprobe`/`ffmpeg` invocation over a presigned HTTP URL — avoids an unmaintained wrapper and avoids copying up to 10GB per job; the thumbnail frame is taken at 10% of the duration (falling back to the first frame for very short videos), scaled to 1280px wide JPEG.

**Libraries:** `ffmpeg` (Debian package — system binaries `ffprobe`/`ffmpeg`)

### phase-03-videos/TD-07

**Recommendation:** Random 11-char base64url slug with a unique index and retry — short and non-enumerable, uses only `node:crypto`, and keeps the internal UUID out of public URLs.

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** API endpoints proxying ranged reads — satisfies streaming via standard `Range`/`206` and download via `Content-Disposition` with private storage and a single access rule, and it is verifiable end-to-end in the Compose stack; Option B remains a drop-in optimization (same routes, redirect instead of pipe) when a public storage/CDN endpoint exists.

**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** `draft → processing → ready | failed` with 3 attempts and exponential backoff — the smallest state machine that matches the phase scope while being resilient to transient errors; `failed` stores the reason for later reprocessing features.

**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** Server-defined 64 MiB part size, 10 GiB max and `video/*` content types — deterministic part math for resume and simple validation; values live in env so they can be tuned without code changes.

**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** Real infrastructure with an in-process worker and an isolated queue prefix — deterministic, fully real, and compatible with the shared-DB `--runInBand` policy; the Compose worker is verified separately by a manual smoke run.

**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** @nestjs/config — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Joi — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Namespaced/grouped with registerAs — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability; the roadmap explicitly calls for auth, email, and storage namespaces.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Shared registerAs factory — `data-source.ts` imports the factory, calls `dotenv.config()`, then calls the factory. Zero duplication.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-02

**Recommendation:** Custom guards with `@nestjs/jwt` only (decision diverged from the `@nestjs/passport` recommendation) — global `JwtAuthGuard` via `APP_GUARD`, `@Public()` opt-out, `@CurrentUser()` exposes `{ sub, email }`.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — documented NestJS approach; decorators already used across the project.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — machine-readable `{ statusCode, error, message }` with domain codes; services throw `DomainException` subclasses, the global filter maps them.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — guard registered as `APP_GUARD` in `AuthModule`; single-instance in-memory storage.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-10

**Recommendation:** `[a-z0-9_]` allowlist + `user_<random>` fallback for channel nickname; collisions resolved with a pre-check plus retry on unique violation.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** `@nestjs/swagger` + CLI plugin (`classValidatorShim: true`, `introspectComments: true`) — reuses the existing class-validator decorators to infer schemas.

**Libraries:** `@nestjs/swagger`

### openapi-docs-nestjs/TD-02

**Recommendation:** Both runtime UI and an exported `openapi.json` (`npm run openapi:export`) — foundation for frontend codegen.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Swagger UI only in dev/staging via `SWAGGER_ENABLED` env flag.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by the Joi schema in `src/config/env.validation.ts` (`allowUnknown: true, abortEarly: false`); `.env.example` lists every key with Compose-compatible defaults. _(from phase 01)_
- Config is injected via `ConfigType<typeof xxxConfig>` + `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts. _(from phase 01)_
- `TypeOrmModule.forRootAsync` with `autoLoadEntities: true`, `synchronize: false`; schema changes only via generated migrations in `src/database/migrations/`. _(from phase 01)_
- Every service host uses the Compose service name (`db`, `mailpit`, …), never `localhost`. _(from phase 01)_
- Global `JwtAuthGuard` (`APP_GUARD`) protects every route; public routes opt out with `@Public()`; protected handlers carry `@ApiBearerAuth('access-token')`. _(from phase 02)_
- Services throw `DomainException` subclasses (`src/common/exceptions/domain.exception.ts`); the global `DomainExceptionFilter` renders `{ statusCode, error, message }`; validation errors render `error: 'VALIDATION_ERROR'`. _(from phase 02)_
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; DTOs use class-validator only (Swagger plugin infers schemas). _(from phase 02)_
- Each user owns exactly one channel (`channels.user_id` unique, created at registration by `ChannelsService`); `ChannelsModule` exports `ChannelsService`. _(from phase 02)_
- Unique-handle generation retries on PostgreSQL `23505` with a pre-check (and savepoints inside transactions). _(from phase 02)_
- Integration/e2e suites share one DB and run `--runInBand`; tables cleaned with `DELETE FROM` in FK order (`src/test/create-test-data-source.ts → cleanAllTables`). _(from phase 02)_
- Controllers are documented with `@ApiTags`, `@ApiOperation`, `@ApiResponse` per status referencing `ApiErrorEnvelope`. _(from openapi-docs-nestjs)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` not initialized in that phase (later delivered by slice phase-02-auth-frontend). |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` § 3 Feature Implementation Checklist)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit (mock repo) + Integration (DB contract) |
| Service with DB only | Integration |
| Service with configured lib | Unit with real lib + test config |
| Service with side-effect dep (email, storage) | Integration with real capture service or local adapter |
| Module with configured imports (incl. `BullModule.registerQueue()`) | Unit: compilation test |
| Controller | E2E only |
| DTO | E2E: one validation wiring test per endpoint |
| Guard | E2E (+ Unit if complex logic) |
| Pipe | Unit |
| Exception Filter | Unit + E2E |

External systems (`references/external-systems.md`): PostgreSQL — real (Docker); **Object Storage — local filesystem adapter in development and tests, S3 in production**; Message Queue — real broker in Docker (BullMQ example with `getQueueToken`); Email — Mailpit.
