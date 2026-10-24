import { randomBytes } from 'node:crypto';
import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { createSampleVideo, SampleVideo } from '../src/test/sample-video';
import { WorkerModule } from '../src/worker.module';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';
import { completeUpload, startAndUploadParts } from './helpers/video-upload';

function binary(
  res: request.Response,
  cb: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Video pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let worker: INestApplicationContext;
  let dataSource: DataSource;
  let sample: SampleVideo;
  let token: string;

  beforeAll(async () => {
    useIsolatedQueuePrefix();
    app = await createE2eApp();
    const workerModule = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    worker = await workerModule.init();
    dataSource = app.get(DataSource);
    sample = await createSampleVideo(4);
  }, 60000);

  afterAll(async () => {
    await sample.cleanup();
    await worker.close();
    await app.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    token = await registerConfirmAndLogin(app, 'pipeline@example.com');
  });

  async function waitUntilProcessed(slug: string): Promise<any> {
    for (let i = 0; i < 120; i++) {
      const res = await request(app.getHttpServer())
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body.status === 'ready' || res.body.status === 'failed') {
        return res.body;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Video ${slug} was not processed in time`);
  }

  it('uploads directly to storage, processes in the background and delivers the video', async () => {
    const uploaded = await startAndUploadParts(app, token, sample.bytes);
    const completed = await completeUpload(app, token, uploaded);
    expect(completed.status).toBe(202);
    expect(completed.body.status).toBe('processing');

    const video = await waitUntilProcessed(uploaded.slug);
    expect(video.status).toBe('ready');
    expect(video.duration_seconds).toBeGreaterThan(0);
    expect(video.metadata).toMatchObject({ width: 320, height: 240 });
    expect(video.thumbnail_url).toBe(`/videos/${uploaded.slug}/thumbnail`);

    const ranged = await request(app.getHttpServer())
      .get(video.stream_url)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(binary);
    expect(ranged.status).toBe(206);
    expect(ranged.body).toEqual(sample.bytes.subarray(0, 100));

    const download = await request(app.getHttpServer())
      .get(video.download_url)
      .buffer(true)
      .parse(binary);
    expect(download.status).toBe(200);
    expect(download.body).toEqual(sample.bytes);

    const thumbnail = await request(app.getHttpServer())
      .get(video.thumbnail_url)
      .buffer(true)
      .parse(binary);
    expect(thumbnail.status).toBe(200);
    expect((thumbnail.body as Buffer).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  it('ends in failed with a processing error for a file that is not a video', async () => {
    const uploaded = await startAndUploadParts(app, token, randomBytes(8192), {
      fileName: 'not-a-video.mp4',
    });
    expect((await completeUpload(app, token, uploaded)).status).toBe(202);

    const video = await waitUntilProcessed(uploaded.slug);
    expect(video.status).toBe('failed');
    expect(video.processing_error).toEqual(expect.any(String));
  });

  it('gives each uploaded video its own unique slug', async () => {
    const first = await startAndUploadParts(app, token, sample.bytes, {
      title: 'one',
    });
    const second = await startAndUploadParts(app, token, sample.bytes, {
      title: 'two',
    });

    expect(first.slug).not.toBe(second.slug);
    expect(first.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(second.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});
