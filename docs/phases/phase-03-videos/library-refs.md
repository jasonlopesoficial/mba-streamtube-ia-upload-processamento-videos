---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-23T17:05:00-03:00"
  bullmq:
    version: "^6.4.0"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-10-23T17:05:00-03:00"
  ioredis:
    version: "^5"
    context7_id: "—"
    fetched_at: "2026-10-24T07:40:00-03:00"
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-23T17:05:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-23T17:05:00-03:00"
  ffmpeg:
    version: "Debian bookworm/trixie package (system binaries)"
    context7_id: "—"
    fetched_at: "2026-10-23T17:05:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T18:03:52-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this phase. Pulled via Context7 (`/nestjs/docs.nestjs.com` → Techniques › Queues; `/websites/bullmq_io`; `/aws/aws-sdk-js-v3`). Everything runs locally: the AWS SDK is only an S3-protocol client pointed at the MinIO container — no AWS account is involved.

Installed-version check (2026-10-23, `npm view`; revised 2026-10-24): `@nestjs/bullmq@11.0.5` (CommonJS; peer: `@nestjs/core ^10 || ^11`, `bullmq ^3–^6`) — `12.x` is ESM-only and does not load under the project's CommonJS Jest runtime; `bullmq@6.4.x` + `ioredis@^5` (BullMQ 6 made `ioredis` an optional peer: without it `Queue` fails with "could not load the optional 'ioredis' package"), `@aws-sdk/client-s3@3.1156.0`, `@aws-sdk/s3-request-presigner@3.1156.0`. Compatible with the installed NestJS 11.

## @nestjs/bullmq + bullmq — maps to `phase-03-videos/TD-01`, `TD-05`, `TD-09`, `TD-11`

### Root config (async, from a `registerAs` namespace)

`BullModule.forRoot/forRootAsync` options are passed to the BullMQ `Queue` constructor: `connection` (Redis `host`/`port`), `prefix` (key prefix, default `bull`), `defaultJobOptions`.

```typescript
BullModule.forRootAsync({
  inject: [queueConfig.KEY],
  useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
    connection: { host: cfg.redisHost, port: cfg.redisPort },
    prefix: cfg.prefix,               // tests use an isolated prefix (TD-11)
  }),
});
BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE });
```

### Producer

```typescript
constructor(@InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue) {}
await this.queue.add('process-video', { videoId }, {
  jobId: videoId,                     // dedupe: same video never enqueued twice while job exists
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 1000,
});
```

Caveat (BullMQ docs, throttle pattern): a removed job no longer counts for `jobId` dedupe.

### Consumer (separate process)

Consumer classes are `@Processor(name)` providers extending `WorkerHost` and implementing `process(job)`; they must be registered as providers. Worker events via `@OnWorkerEvent('failed' | 'completed' | 'active')` inside the processor class.

```typescript
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  async process(job: Job<VideoProcessingJobData>): Promise<void> { ... }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<VideoProcessingJobData>, error: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) { /* final failure → mark video failed */ }
  }
}
```

- `throw new UnrecoverableError(msg)` moves the job straight to failed regardless of `attempts` (use for invalid media).
- Graceful shutdown: `worker.close()` stops taking jobs and waits for active ones; with Nest, call `app.enableShutdownHooks()` in the worker entrypoint so `WorkerHost` closes on SIGTERM.
- Entrypoint: `NestFactory.createApplicationContext(WorkerModule)` — no HTTP server.

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner — maps to `TD-02`, `TD-03`, `TD-04`, `TD-06`, `TD-08`

### Client for MinIO

```typescript
new S3Client({
  endpoint: cfg.endpoint,           // http://minio:9000 (Compose service name)
  region: cfg.region,               // any value for MinIO, e.g. us-east-1
  forcePathStyle: true,             // host/bucket/key — required by MinIO
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
```

- Since the flexible-checksums change, the default `requestChecksumCalculation` is `WHEN_SUPPORTED`, which adds `x-amz-checksum-crc32` / `x-amz-sdk-checksum-algorithm` to operations such as `PutObject`/`UploadPart`. For presigned part uploads made by a third-party client and for S3-compatible servers, set both options to `WHEN_REQUIRED` (aws-sdk-js-v3 issue #6810).
- A presigned URL is signed for the client's `endpoint` host. Use a **second client** configured with the public endpoint (`S3_PUBLIC_ENDPOINT`) only for presigning (ICC-2 resolution).

### Presigning

```typescript
const url = await getSignedUrl(publicClient,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }),
  { expiresIn: 3600 });            // default 900 s
```

`Content-Type` is unsigned by default and the payload is `UNSIGNED-PAYLOAD`: part size is not enforced by the signature, so the API verifies the final object size with `HeadObject` after `CompleteMultipartUpload`.

### Multipart commands used

`CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`; `ListPartsCommand({ Bucket, Key, UploadId })` → `Parts[{ PartNumber, ETag, Size }]` (resume); `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }] } })`; `AbortMultipartUploadCommand`. S3 limits: part 5 MiB–5 GiB (last part may be smaller), ≤ 10,000 parts.

### Ranged reads (streaming)

```typescript
const res = await client.send(new GetObjectCommand({ Bucket, Key, Range: 'bytes=0-9' }));
// res.ContentRange 'bytes 0-9/43', res.ContentLength 10, res.AcceptRanges 'bytes'
// res.Body is a Node.js Readable in Node — pipe it, never buffer large objects;
// if not consumed, call res.Body.destroy() to free the socket.
```

`HeadObjectCommand` → `ContentLength`, `ContentType`. `HeadBucketCommand` / `CreateBucketCommand` for bucket bootstrap. `PutObjectCommand({ Body: Buffer, ContentType: 'image/jpeg' })` for thumbnails.

## ffmpeg / ffprobe (system binaries) — maps to `TD-06`

Installed in the dev image via `apt install -y ffmpeg`. Invoked with `node:child_process` `spawn` (no wrapper — `fluent-ffmpeg` is deprecated/archived since 2025-05-22).

- Probe: `ffprobe -v error -print_format json -show_format -show_streams <input>` → JSON with `format.duration` (string seconds), `format.format_name`, `format.bit_rate`, `streams[].codec_type|codec_name|width|height`.
- Frame: `ffmpeg -v error -ss <seconds> -i <input> -frames:v 1 -vf scale=1280:-2 -f image2 -c:v mjpeg pipe:1` → JPEG bytes on stdout. Placing `-ss` before `-i` performs input seeking (with HTTP inputs FFmpeg issues `Range` requests).
- HTTP inputs: a presigned GET URL from the **internal** client works as `<input>`.
- Test fixture: `ffmpeg -f lavfi -i testsrc=duration=3:size=320x240:rate=25 -pix_fmt yuv420p -movflags +faststart sample.mp4`.
