import { registerAs } from '@nestjs/config';

export default registerAs('videos', () => ({
  maxSizeBytes: Number(process.env.VIDEO_MAX_SIZE_BYTES || 10737418240),
  uploadPartSizeBytes: Number(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || 67108864,
  ),
  processingAttempts: parseInt(
    process.env.VIDEO_PROCESSING_ATTEMPTS || '3',
    10,
  ),
  processingBackoffMs: parseInt(
    process.env.VIDEO_PROCESSING_BACKOFF_MS || '5000',
    10,
  ),
  workerConcurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '1', 10),
  probeTimeoutMs: parseInt(process.env.VIDEO_PROBE_TIMEOUT_MS || '120000', 10),
}));
