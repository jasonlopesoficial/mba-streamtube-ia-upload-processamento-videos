# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis (queue):** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO (object storage):** `docker compose exec minio mc ready local` — expect `The cluster 'local' is ready`
- **Video worker:** `docker compose logs video-worker` — expect `Worker listening on queue "video-processing"`

The `video-worker` service is part of the infrastructure (it starts with `docker compose up -d`); it is not the API server.

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `video-worker` — video processing worker (same image/volume as `nestjs-api`, runs `npm run start:worker:dev`; FFmpeg installed by `Dockerfile.dev`)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `redis` — Redis 7 (BullMQ queue), port `6379`
- `minio` — MinIO object storage (S3 API), API port `9000`, web console `9001`; image `cgr.dev/chainguard/minio` (MinIO no longer publishes free images); root credentials = `S3_ACCESS_KEY` / `S3_SECRET_KEY`
- `mailpit` — SMTP capture, ports `1025` (SMTP) / `8025` (UI)

Everything runs locally — no cloud account is required. The AWS SDK is only used as an S3-protocol client pointed at MinIO.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker                     # Run the compiled video worker (dist/worker)
npm run start:worker:dev                 # Video worker via ts-node + node --watch (used by the video-worker service)

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

**Queue/worker/storage tests use the real Compose services** (MinIO, Redis, FFmpeg — no mocks). Any test that touches the queue must call `useIsolatedQueuePrefix()` (`src/test/queue.ts`) **before** compiling its module, so the running `video-worker` container (default prefix `streamtube`) never consumes test jobs; tests that need processing boot `WorkerModule` in-process. Fixtures: `src/test/sample-video.ts` (generates an MP4 with FFmpeg), `src/test/video-fixtures.ts`, `test/helpers/app.ts`, `test/helpers/video-upload.ts`. Backend E2E specs live in `specs/*.plan.md`.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Environment Variables (Phase 03)

Defined in `src/config/env.validation.ts` (Joi) and listed in `.env.example`:

- **Storage (`src/config/storage.config.ts`):** `S3_ENDPOINT` (default `http://minio:9000`), `S3_PUBLIC_ENDPOINT` (host embedded in presigned upload URLs — the URL as seen by the uploading client; defaults to `S3_ENDPOINT`, which works inside the Docker network and in tests), `S3_REGION`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` (required), `S3_BUCKET` (default `streamtube`, created on boot if missing), `S3_PRESIGN_EXPIRATION_SECONDS` (default 3600).
- **Queue (`src/config/queue.config.ts`):** `REDIS_HOST` (default `redis`), `REDIS_PORT` (6379), `QUEUE_PREFIX` (BullMQ key prefix, default `streamtube`).
- **Videos (`src/config/videos.config.ts`):** `VIDEO_MAX_SIZE_BYTES` (10737418240), `VIDEO_UPLOAD_PART_SIZE_BYTES` (67108864; 5 MiB–5 GiB), `VIDEO_PROCESSING_ATTEMPTS` (3), `VIDEO_PROCESSING_BACKOFF_MS` (5000), `VIDEO_WORKER_CONCURRENCY` (1), `VIDEO_PROBE_TIMEOUT_MS` (120000).

## Videos Module (Phase 03)

- **Modules:** `src/storage/` (`StorageService` — AWS SDK v3 against MinIO: multipart, presign, ranged `GetObject`; keys `videos/{id}/source` and `thumbnails/{id}.jpg`), `src/queue/` (`QueueModule` — BullMQ root connection), `src/videos/` (entity, `VideosRepository`, `VideosService`, `VideosController`, `VideoProcessingProducer`), `src/video-processing/` (`MediaProbeService` running `ffprobe`/`ffmpeg`, `VideoProcessingService`, `VideoProcessingProcessor`). Shared roots: `AppConfigModule` (`src/config/app-config.module.ts`) and `DatabaseModule` (`src/database/database.module.ts`) are imported by both `AppModule` and `WorkerModule`.
- **Worker entrypoint:** `src/worker.ts` boots `WorkerModule` with `NestFactory.createApplicationContext` (no HTTP server). `WorkerModule` imports `UsersModule` only so the `User` entity (related to `Channel`) is registered for `autoLoadEntities`.
- **Entity:** `videos` table (`src/videos/entities/video.entity.ts`, migration `1792837622034-CreateVideos`) — belongs to a channel (`channel_id`, cascade), unique 11-char `slug`, `status` enum `draft | processing | ready | failed`, storage keys, `duration_seconds`, `metadata` (jsonb), `processing_error`.
- **Endpoints (`VideosController`, `@SkipThrottle()` — rate limiting stays scoped to auth):** `POST /videos` (201), `POST /videos/:slug/upload/parts` (200), `GET /videos/:slug/upload/parts` (200), `POST /videos/:slug/upload/complete` (202), `GET /videos/:slug` (owner), and the `@Public()` `ready`-only `GET /videos/:slug/stream` (200/206/416), `/download`, `/thumbnail`.
- **Queue contract:** queue `video-processing`, job `process-video` with `{ videoId }`, `jobId = videoId`; status transitions are conditional updates (`VideosRepository.transitionStatus`), so redelivered jobs are no-ops.

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Troubleshooting

- `docker compose build` / `up --build` stops with `additional privileges requested: pass "--allow=fs.read=<path>"`: Buildx Bake's filesystem entitlement check rejects this checkout path (it contains non-ASCII characters). Run the command with `BUILDX_BAKE_ENTITLEMENTS_FS=0`, e.g. `BUILDX_BAKE_ENTITLEMENTS_FS=0 docker compose up -d --build`.
- Host port already in use (another local Postgres/Mailpit): create a local, untracked `compose.override.yaml` remapping only the host side with `ports: !override [...]` — container-to-container traffic still uses the service names.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings; test files (`*.spec.ts`, `*.integration-spec.ts`, `*.e2e-spec.ts`) disable `no-unsafe-assignment|member-access|return|call` and `unbound-method` (untyped `res.body` / jest mocks)

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
