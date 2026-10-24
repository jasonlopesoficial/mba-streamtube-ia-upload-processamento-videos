import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';
import { completeUpload, startAndUploadParts } from './helpers/video-upload';

/** Collects the raw response body as a Buffer regardless of content type. */
function binary(
  res: request.Response,
  cb: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('videos-stream', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let slug: string;
  const file = randomBytes(256 * 1024);

  beforeAll(async () => {
    useIsolatedQueuePrefix();
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const token = await registerConfirmAndLogin(app, 'streamer@example.com');
    const uploaded = await startAndUploadParts(app, token, file);
    expect((await completeUpload(app, token, uploaded)).status).toBe(202);
    await dataSource
      .getRepository(Video)
      .update({ id: uploaded.id }, { status: 'ready' });
    slug = uploaded.slug;
  });

  const stream = () =>
    request(app.getHttpServer()).get(`/videos/${slug}/stream`);

  // 1. Streaming
  test('range-returns-206-with-exact-bytes', async () => {
    const res = await stream()
      .set('Range', 'bytes=0-1023')
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${file.length}`);
    expect(res.headers['content-length']).toBe('1024');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.body).toEqual(file.subarray(0, 1024));
  });

  test('no-range-returns-full-body', async () => {
    const res = await stream().buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(file.length));
    expect(res.body).toEqual(file);
  });

  test('range-beyond-size-is-unsatisfiable', async () => {
    const res = await stream().set('Range', `bytes=${file.length}-`);

    expect(res.status).toBe(416);
    expect(res.body.error).toBe('RANGE_NOT_SATISFIABLE');
    expect(res.headers['content-range']).toBe(`bytes */${file.length}`);
  });

  test('non-ready-video-is-not-found', async () => {
    await dataSource
      .getRepository(Video)
      .update({ slug }, { status: 'processing' });

    const res = await stream();

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
