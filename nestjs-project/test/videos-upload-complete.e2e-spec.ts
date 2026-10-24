import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { S3_CLIENT } from '../src/storage/storage.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { obliterateQueue, useIsolatedQueuePrefix } from '../src/test/queue';
import { VIDEO_PROCESSING_QUEUE } from '../src/video-processing/video-processing.constants';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';
import { completeUpload, startAndUploadParts } from './helpers/video-upload';

describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let queue: Queue;
  let ownerToken: string;
  let otherToken: string;
  const file = randomBytes(4096);

  beforeAll(async () => {
    useIsolatedQueuePrefix();
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    queue = app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await obliterateQueue(queue);
    await app.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await obliterateQueue(queue);
    ownerToken = await registerConfirmAndLogin(app, 'owner@example.com');
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');
  });

  const findVideo = (id: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  // 1. Upload completion
  test('completes-and-enqueues-processing', async () => {
    const uploaded = await startAndUploadParts(app, ownerToken, file);

    const res = await completeUpload(app, ownerToken, uploaded);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('processing');
    const job = await queue.getJob(uploaded.id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: uploaded.id });
    expect(job?.id).toBe(uploaded.id);
  });

  test('wrong-etag-keeps-draft', async () => {
    const uploaded = await startAndUploadParts(app, ownerToken, file);

    const res = await completeUpload(app, ownerToken, {
      ...uploaded,
      parts: [{ part_number: 1, etag: '"00000000000000000000000000000000"' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('UPLOAD_INCOMPLETE');
    expect((await findVideo(uploaded.id)).status).toBe('draft');
  });

  test('size-mismatch-fails-video', async () => {
    const uploaded = await startAndUploadParts(app, ownerToken, file, {
      declaredSize: file.length + 100,
    });

    const res = await completeUpload(app, ownerToken, uploaded);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('UPLOAD_SIZE_MISMATCH');
    const row = await findVideo(uploaded.id);
    expect(row.status).toBe('failed');
    expect(row.processing_error).not.toBeNull();
    const s3 = app.get<S3Client>(S3_CLIENT);
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: row.storage_key,
        }),
      ),
    ).rejects.toBeDefined();
  });

  test('repeated-completion-conflicts', async () => {
    const uploaded = await startAndUploadParts(app, ownerToken, file);
    await completeUpload(app, ownerToken, uploaded);

    const res = await completeUpload(app, ownerToken, uploaded);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_VIDEO_STATE');
  });

  test('hides-video-from-other-users', async () => {
    const uploaded = await startAndUploadParts(app, ownerToken, file);

    const res = await completeUpload(app, otherToken, uploaded);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
