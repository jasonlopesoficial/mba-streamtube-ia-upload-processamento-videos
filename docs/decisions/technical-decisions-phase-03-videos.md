---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-23
scope_description: "Backend foundation for video upload and processing: object storage usage (S3/MinIO), background job queue and video worker (FFmpeg), direct-to-storage upload of files up to 10GB with draft pre-registration, automatic metadata extraction and thumbnail generation, unique per-video URL, streaming and download delivery, and the video status lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the videos module (draft pre-registration, upload handshake, status, streaming, download), the object-storage integration, the job queue producer, and the video worker (consumer + FFmpeg) plus the new Compose infrastructure (storage, queue, worker).
- `next-frontend/` — no open decision in this document: Phase 03 has no UI capability bullet in `docs/project-plan.md` (the player/watch page is Fase 05 and the video management UI is Fase 04). The upload handshake is still recorded as `Cross-layer` (TD-02) so a future frontend consumes the same contract.

**Given (not an open decision):** object storage is S3-compatible — MinIO runs locally in Docker and is swapped for Amazon S3 in production (architecture diagram `docs/diagrams/software-arch.mermaid`, container "Object Storage (S3/MinIO)"). The TDs below decide *how* storage is used, not *which* storage.

**Local-only operation (constraint confirmed by the user on 2026-10-23):** no cloud account is available or required. Every component of this phase — MinIO (storage), Redis (queue), the video worker (FFmpeg) and PostgreSQL — runs as a local Docker Compose service; credentials are local values in `.env`. Any S3 client library chosen below is used only as an S3-protocol client pointed at MinIO; Amazon S3 remains a future production target reachable by env changes only.

**Installed stack constraints** (from `nestjs-project/package.json`): NestJS 11 (`@nestjs/common` / `@nestjs/core` ^11.0.1), TypeORM ^0.3.28, PostgreSQL 17, Node 25 (`Dockerfile.dev`), CommonJS output (`module: nodenext` without `"type": "module"`), Jest 30 + supertest.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram leaves the "Message Queue" container as **TBD**. The API must publish a video-processing job after an upload completes, and a separate worker must consume it with retries. The choice adds (or not) a new infrastructure service to Compose and defines the producer/consumer API used by both sides. This is the main stack decision of the phase.

**Options:**

### Option A: BullMQ on Redis (`@nestjs/bullmq` + `bullmq`)
- Redis-backed job queue with first-class NestJS integration: `BullModule.forRootAsync` / `registerQueue`, `@InjectQueue()` producer, `@Processor()` + `WorkerHost` consumer, `@OnWorkerEvent('failed')` hooks (NestJS docs → Techniques → Queues).
- **Pros:** official Nest recipe (same DI/config patterns already used by the project); built-in `attempts` + exponential `backoff`, `jobId` deduplication, `removeOnComplete/removeOnFail`, concurrency per worker; consumer can run in a separate process via `NestFactory.createApplicationContext`. `@nestjs/bullmq@12` peer-depends on `@nestjs/core ^11` and `bullmq ^6`.
- **Cons:** adds Redis to Compose (one more service to run, persist and monitor); job state lives outside PostgreSQL, so DB status and queue state must be reconciled by the worker.

### Option B: pg-boss on the existing PostgreSQL
- Job queue implemented on PostgreSQL tables using `SKIP LOCKED`; producer and consumer use the `pg-boss` client directly.
- **Pros:** zero new infrastructure (PostgreSQL is already in the stack); jobs can be enqueued in the same database transaction as the video row (transactional outbox for free); retries and expiration supported.
- **Cons:** no official NestJS module (manual lifecycle wiring); polling-based, adds write load to the primary DB that also serves the API; smaller ecosystem and fewer NestJS examples.

### Option C: RabbitMQ (AMQP)
- Message broker; NestJS microservices transport (`@nestjs/microservices` RMQ) or `amqplib` directly, with dead-letter exchanges for failures.
- **Pros:** mature broker, strong delivery semantics, routing flexibility; language-agnostic consumers.
- **Cons:** heavier operational footprint; retries with backoff require DLX/TTL plumbing instead of a job option; the Nest RMQ transport is message-oriented (no job state/progress), so retry/attempt bookkeeping is hand-rolled.

**Recommendation:** BullMQ on Redis — it is the queue documented by NestJS itself, giving retries/backoff/deduplication as job options and a `WorkerHost` consumer that runs in a separate process with the same `ConfigModule`/`TypeOrmModule` wiring the project already uses; the cost is one Redis container, acceptable for a video platform whose processing is the heaviest workload. pg-boss would avoid Redis but loads the primary DB and has no Nest integration.

**Decision:** A (BullMQ on Redis)
**Libraries:** `@nestjs/bullmq@^12.0.0`, `bullmq@^6.4.0`

---

## TD-02: Upload Protocol for Files up to 10GB

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** A 10GB file must not hold the API during transfer (`docs/project-plan.md` § Pontos de Atenção also asks that the upload "permita retomar em caso de falha de conexão"). The handshake sequence is a contract between the API and any client (frontend in a later phase), so it is decided once as Cross-layer. Amazon S3 caps a single `PUT` at 5GB and requires multipart upload above that (parts 5MiB–5GiB, max 10,000 parts).

**Options:**

### Option A: Stream the file through the API (multipart/form-data → S3)
- Client posts the file to the API; the API streams the request body (busboy) into an S3 managed upload.
- **Pros:** simplest client; API sees every byte (can validate on the fly).
- **Cons:** every byte crosses the API — 10GB uploads hold a connection, socket and bandwidth on the API for minutes/hours; no resume; scaling the API is driven by upload traffic. This is exactly what the phase must avoid.

### Option B: Single presigned `PUT` URL
- API pre-registers the video and returns one presigned `PutObject` URL; client uploads directly to storage.
- **Pros:** API is out of the data path; trivial client.
- **Cons:** S3 rejects single `PUT` above 5GB — cannot meet the 10GB requirement; no resume (a dropped connection restarts from zero).

### Option C: Presigned S3 multipart upload (direct to storage)
- `POST` to the API pre-registers the video as draft and calls `CreateMultipartUpload`; the client asks the API for presigned `UploadPart` URLs, uploads parts straight to storage, then asks the API to `CompleteMultipartUpload` with the part ETags. Already-uploaded parts can be listed (`ListParts`) to resume.
- **Pros:** API never touches file bytes; supports 10GB+ (up to 10,000 parts); resumable per part; parallel parts; works identically on MinIO and S3 (`@aws-sdk/s3-request-presigner` `getSignedUrl` on `UploadPartCommand`).
- **Cons:** 3-step handshake for the client; presigned URLs embed the storage host in the signature, so the URL host the client sees must be configured explicitly (public endpoint ≠ internal Compose host); orphaned multipart uploads need cleanup (S3 lifecycle rule / abort).

### Option D: tus resumable protocol (tusd or `@tus/server`)
- A tus server receives chunked `PATCH` uploads with offsets and writes to S3.
- **Pros:** standard resumable protocol with mature clients (Uppy, tus-js-client).
- **Cons:** either the API becomes the data path again (`@tus/server` inside Nest) or a new tusd service plus hook integration is added; more infrastructure for a capability S3 multipart already covers.

**Recommendation:** Presigned S3 multipart upload — it is the only option that keeps the API out of the data path *and* supports 10GB with resume using the storage that is already a given (MinIO/S3), with no extra service; the handshake complexity is confined to three small endpoints, and the public-vs-internal endpoint issue is handled by a dedicated public endpoint setting for presigning.

**Decision:** C (Presigned S3 multipart upload)
**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-03: S3 Client Library

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** API (presigning, multipart handshake, ranged reads) and worker (reads source, writes thumbnail) need an S3 client that works against MinIO locally and Amazon S3 in production without code changes.

**Options:**

### Option A: AWS SDK for JavaScript v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Modular official SDK; `S3Client({ endpoint, forcePathStyle: true, region, credentials })` targets MinIO; commands for multipart, ranged `GetObject`, `HeadObject`; presigner signs any command.
- **Pros:** official S3 client — production swap is config-only; first-class TypeScript types; supports every operation needed (multipart, `Range`, presign).
- **Cons:** larger dependency surface; verbose command style.

### Option B: MinIO JavaScript client (`minio`)
- MinIO's own S3-compatible SDK (`presignedUrl`, `putObject`, `getPartialObject`).
- **Pros:** compact API; good MinIO docs.
- **Cons:** presigned multipart part URLs are not a first-class API; production target is S3, so the canonical S3 SDK is the safer long-term contract.

**Recommendation:** AWS SDK v3 — the production target is Amazon S3, and the SDK covers presigned `UploadPart`, ranged `GetObject` and multipart completion natively; MinIO is reached with `endpoint` + `forcePathStyle: true`, so local/prod differ only in environment variables.

**Decision:** A (AWS SDK v3)
**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-04: Bucket and Object Key Organization

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The key layout is shared by the API (writes source via multipart, reads for streaming/download), the worker (reads source, writes thumbnail), the env schema (bucket name) and the Compose bootstrap. It is a cross-component contract.

**Options:**

### Option A: One private bucket, prefixes per artifact
- Bucket `streamtube` (env `S3_BUCKET`); source at `videos/{videoId}/source`, thumbnail at `thumbnails/{videoId}.jpg`. All objects private; access only through the API or short-lived presigned URLs.
- **Pros:** single bucket to create/configure; keys derived from the immutable video UUID (never from user input or the public slug); lifecycle rules can target prefixes.
- **Cons:** one policy for everything (fine while all objects are private).

### Option B: Two buckets (`videos`, `thumbnails`)
- Separate buckets per artifact type.
- **Pros:** independent policies (e.g., public-read thumbnails later), separate lifecycle/cost reporting.
- **Cons:** two buckets to provision and two env vars; no current need for different policies.

**Recommendation:** One private bucket with UUID-derived prefixes — the phase has no requirement for different access policies, and keys based on `videoId` keep storage independent from the public slug (TD-07) and from the original filename.

**Decision:** A (One private bucket, UUID-derived prefixes)
**Libraries:** —

**Revisions:**
- 2026-10-24 — Local MinIO container image is `cgr.dev/chainguard/minio:latest` instead of `minio/minio`. Rationale: MinIO stopped publishing free images (`minio/minio` on Docker Hub returns "repository does not exist"; `quay.io/minio/minio` requires authentication); the Chainguard image is MinIO built from source, free to pull, and ships `mc` for the Compose healthcheck. Bucket/key layout unchanged.

---

## TD-05: Video Worker Runtime

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** FFmpeg work is CPU/IO heavy and must not run inside the API process (architecture diagram: separate "Video Worker (FFmpeg)" container). The decision shapes the Compose topology, the Docker image (FFmpeg binaries) and the source layout.

**Options:**

### Option A: Same NestJS codebase, separate entrypoint and Compose service
- `src/worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP server); a `video-worker` Compose service runs it from the same image (with FFmpeg installed). Entities, config and storage modules are shared.
- **Pros:** reuses entities, config namespaces, storage service and test tooling; one `package.json`; the worker scales independently (`docker compose up --scale video-worker=N`).
- **Cons:** the image carries both API and worker code; module boundaries must keep the API from importing the processor.

### Option B: Processor inside the API process
- Register the `@Processor()` in `AppModule`.
- **Pros:** zero new service.
- **Cons:** FFmpeg competes with HTTP handling for CPU — contradicts "sem impacto na performance" and the architecture diagram.

### Option C: Separate subproject (`video-worker/`)
- Independent Node project with its own manifest and Dockerfile.
- **Pros:** strongest isolation; independent deploys.
- **Cons:** duplicates entity/config/storage code or requires a shared package (monorepo tooling decision not taken yet); doubles lint/test setup.

**Recommendation:** Same codebase with a separate entrypoint and Compose service — it honors the architecture's separate container while reusing the TypeORM entity, config namespaces and storage client without introducing monorepo tooling.

**Decision:** A (Same codebase, separate entrypoint and Compose service)
**Libraries:** —

---

## TD-06: Metadata Extraction and Thumbnail Generation

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker must read duration/stream metadata and capture one frame of files up to 10GB. Downloading the whole object to the worker disk before probing costs time and disk proportional to the file size.

**Options:**

### Option A: Invoke `ffprobe`/`ffmpeg` binaries directly (child_process), reading the object over HTTP via a short-lived presigned GET URL
- `ffprobe -v error -print_format json -show_format -show_streams <url>`; `ffmpeg -ss <t> -i <url> -frames:v 1 -vf scale=… -f image2 pipe:1` → JPEG buffer uploaded to the thumbnail key. FFmpeg's HTTP input uses `Range` requests to seek, so only the needed bytes are transferred.
- **Pros:** no wrapper dependency; no full download of 10GB files; JSON output parsed with types we own; binaries come from the Debian `ffmpeg` package in the image.
- **Cons:** we own argument building and process error handling (exit codes, stderr, timeouts); MP4 files with the `moov` atom at the end cause extra range reads (still far less than a full download).

### Option B: `fluent-ffmpeg` wrapper + temp file download
- Download the object to a temp file, then use the `fluent-ffmpeg` fluent API (`ffprobe()`, `screenshots()`).
- **Pros:** convenient API, many examples.
- **Cons:** the package repository was archived (deprecated) in 2025 — no maintenance; temp download of up to 10GB per job requires matching disk and doubles processing time.

### Option C: Direct binaries + temp file download
- Same as A, but the source is first copied to local disk.
- **Pros:** local seeks are fastest; robust to any container layout.
- **Cons:** disk and time proportional to file size (10GB per concurrent job).

**Recommendation:** Direct `ffprobe`/`ffmpeg` invocation over a presigned HTTP URL — avoids an unmaintained wrapper and avoids copying up to 10GB per job; the thumbnail frame is taken at 10% of the duration (falling back to the first frame for very short videos), scaled to 1280px wide JPEG.

**Decision:** A (Direct ffprobe/ffmpeg over presigned HTTP URL)
**Libraries:** `ffmpeg` (Debian package — system binaries `ffprobe`/`ffmpeg`)

---

## TD-07: Unique Video URL Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short public identifier that never collides (`docs/project-plan.md` § Pontos de Atenção: "URL curta e única"). It appears in every public route and in future frontend URLs — a cross-layer contract.

**Options:**

### Option A: Random 11-char base64url slug + unique index + retry
- `crypto.randomBytes(8)` → base64url, truncated to 11 chars (~64 bits, YouTube-like); stored in `videos.slug` with a UNIQUE constraint; on unique violation (SQLSTATE `23505`) regenerate and retry (same retry pattern used for channel nicknames in Phase 02).
- **Pros:** short, non-enumerable (cannot guess other videos), no dependency; DB constraint is the final collision guard.
- **Cons:** randomness means a retry path that is practically never exercised (needs a test that forces a collision).

### Option B: UUID in the URL
- Use `videos.id` directly.
- **Pros:** zero extra column; uniqueness by construction.
- **Cons:** 36-char URLs — not "short"; exposes the internal primary key used for storage keys.

### Option C: Encoded sequential ID (Sqids/Hashids)
- Encode an auto-increment number into a short string.
- **Pros:** short, deterministic, collision-free.
- **Cons:** reversible/enumerable (sequential IDs leak volume and allow scraping); adds a library and a sequence column.

**Recommendation:** Random 11-char base64url slug with a unique index and retry — short and non-enumerable, uses only `node:crypto`, and keeps the internal UUID out of public URLs.

**Decision:** A (Random 11-char base64url slug + unique index + retry)
**Libraries:** —

---

## TD-08: Video Delivery — Streaming and Download

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file, and users must be able to download it. Players (HTML5 `<video>`) rely on HTTP `Range` requests and `206 Partial Content`. The delivery URL shape is consumed by the future frontend.

**Options:**

### Option A: API endpoints proxying ranged reads from storage
- `GET /videos/{slug}/stream` parses `Range`, calls `GetObject` with the same range and pipes the body with `206`, `Content-Range`, `Accept-Ranges: bytes`; `GET /videos/{slug}/download` pipes the full object with `Content-Disposition: attachment`.
- **Pros:** storage stays private and unexposed; access rules (only `ready` videos) enforced in one place; stable URLs; fully testable end-to-end with supertest; Node streams pipe without buffering the file in memory.
- **Cons:** video bytes cross the API (bandwidth/egress on the API tier); a CDN in front of the API is needed at scale.

### Option B: API redirects (302) to a short-lived presigned GET URL
- The API authorizes and redirects; storage serves `Range`/`206` natively.
- **Pros:** API out of the data path; storage/CDN handle bandwidth.
- **Cons:** presigned URLs expire mid-playback for long videos; the public storage host must be reachable by clients (Compose service names are not); URLs leak for their lifetime.

### Option C: HLS adaptive streaming (transcode to segments)
- Worker transcodes to HLS renditions; clients play `.m3u8`.
- **Pros:** adaptive bitrate, CDN-friendly.
- **Cons:** full transcoding of 10GB files (hours of CPU), multiplies storage; well beyond the phase's capability ("sem necessidade de download completo" is satisfied by byte ranges).

**Recommendation:** API endpoints proxying ranged reads — satisfies streaming via standard `Range`/`206` and download via `Content-Disposition` with private storage and a single access rule, and it is verifiable end-to-end in the Compose stack; Option B remains a drop-in optimization (same routes, redirect instead of pipe) when a public storage/CDN endpoint exists.

**Decision:** A (API proxies ranged reads — 206 Partial Content)
**Libraries:** —

---

## TD-09: Video Status Lifecycle and Failure Handling

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The video row is created when the upload starts and must reflect upload and processing progress. The status values are exposed to clients and drive which endpoints accept the video. Failure semantics (retries, terminal state) must be defined for the worker.

**Options:**

### Option A: `draft → processing → ready | failed`, retries with backoff, `failed` terminal with stored reason
- `draft` on upload start; `processing` when the API completes the multipart upload and enqueues the job; worker sets `ready` with metadata + thumbnail; after the final attempt (3 attempts, exponential backoff) the worker sets `failed` and stores `processing_error`. Retries are idempotent (worker skips videos not in `processing`).
- **Pros:** minimal state machine matching the phase statement; transient failures (storage hiccup) retried automatically; failure is visible in the DB with a reason.
- **Cons:** no explicit `uploading` state (an abandoned upload stays `draft`); no user-triggered reprocess in this phase.

### Option B: Add `uploading` / `uploaded` intermediate states
- Separate states for "upload in progress" and "upload finished, waiting queue".
- **Pros:** more granular progress for UIs.
- **Cons:** more transitions to keep consistent without a consumer needing them in this phase; `processing` already covers "enqueued or running".

### Option C: No retries — first failure is terminal
- **Pros:** simplest worker.
- **Cons:** transient storage/network errors permanently fail 10GB uploads.

**Recommendation:** `draft → processing → ready | failed` with 3 attempts and exponential backoff — the smallest state machine that matches the phase scope while being resilient to transient errors; `failed` stores the reason for later reprocessing features.

**Decision:** A (draft → processing → ready | failed, 3 attempts with exponential backoff)
**Libraries:** —

---

## TD-10: Upload Limits and Part Size Policy

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Depends on TD-02 (multipart). The maximum size, part size and accepted content types are enforced by the API (request validation, part-count math), configured via env, and must be known by clients.

**Options:**

### Option A: Server-defined fixed part size (64 MiB, env-configurable), max 10 GiB, `video/*` content types
- `POST /videos` validates `size_bytes ≤ 10 GiB` (10,737,418,240) and `content_type` matching `video/*`; the server returns `part_size` and `part_count = ceil(size / part_size)` (≤ 160 parts at 10 GiB). On completion the API verifies the stored object size equals the declared size.
- **Pros:** one source of truth for part math; well inside S3 limits (5MiB–5GiB per part, ≤10,000 parts); size mismatch detected before processing.
- **Cons:** fixed part size is not optimal for very small files (single part is fine) or very fast links.

### Option B: Client-chosen part size within S3 limits
- **Pros:** clients can tune for their bandwidth.
- **Cons:** server must validate every combination; harder to reason about resume.

**Recommendation:** Server-defined 64 MiB part size, 10 GiB max and `video/*` content types — deterministic part math for resume and simple validation; values live in env so they can be tuned without code changes.

**Decision:** A (Server-defined 64 MiB parts, 10 GiB max, video/*)
**Libraries:** —

---

## TD-11: Test Strategy for Queue, Worker and Storage

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Integration and e2e suites share the Compose infrastructure (`--runInBand`, shared DB per `nestjs-project/CLAUDE.md`). With a long-running `video-worker` container consuming the same queue, tests that enqueue jobs would race with it. The project rule is to exercise real infrastructure instead of mocks.

**Options:**

### Option A: Real MinIO/Redis/FFmpeg, in-process worker with an isolated queue prefix
- Tests use the Compose MinIO and Redis; e2e/integration boot the worker module in-process with a test-only BullMQ key prefix (env-driven), so the Compose worker never sees test jobs; a tiny sample video is generated with FFmpeg (`testsrc`) at test time.
- **Pros:** exercises the real upload → queue → FFmpeg → storage → DB path deterministically; no cross-talk with the dev worker.
- **Cons:** slower tests (FFmpeg + real network); requires FFmpeg in the API container used to run tests.

### Option B: Rely on the Compose `video-worker` container in e2e (poll DB)
- **Pros:** tests the deployed topology.
- **Cons:** non-deterministic (worker must be running the current code); races with table cleanup between suites.

### Option C: Mock queue/storage/FFmpeg in tests
- **Pros:** fast.
- **Cons:** violates the project testing policy ("não mocke o que dá para testar de verdade"); misses presign/range/codec issues.

**Recommendation:** Real infrastructure with an in-process worker and an isolated queue prefix — deterministic, fully real, and compatible with the shared-DB `--runInBand` policy; the Compose worker is verified separately by a manual smoke run.

**Decision:** A (Real infrastructure, in-process worker with isolated queue prefix)
**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | BullMQ on Redis | A |
| TD-02 | Cross-layer | Upload Protocol for Files up to 10GB | Presigned S3 multipart upload | C |
| TD-03 | Backend | S3 Client Library | AWS SDK v3 | A |
| TD-04 | Backend | Bucket and Object Key Organization | One private bucket, UUID prefixes | A |
| TD-05 | Repo-wide | Video Worker Runtime | Same codebase, separate entrypoint + Compose service | A |
| TD-06 | Backend | Metadata Extraction and Thumbnail Generation | Direct ffprobe/ffmpeg over presigned URL | A |
| TD-07 | Cross-layer | Unique Video URL Identifier | Random 11-char base64url slug | A |
| TD-08 | Cross-layer | Video Delivery — Streaming and Download | API proxies ranged reads (206) | A |
| TD-09 | Cross-layer | Video Status Lifecycle and Failure Handling | draft → processing → ready/failed + retries | A |
| TD-10 | Cross-layer | Upload Limits and Part Size Policy | 64 MiB parts, 10 GiB max, video/* | A |
| TD-11 | Backend | Test Strategy for Queue, Worker and Storage | Real infra + in-process worker, isolated prefix | A |
