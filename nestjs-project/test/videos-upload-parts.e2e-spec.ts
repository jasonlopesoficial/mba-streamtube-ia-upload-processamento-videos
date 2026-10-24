import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';

const PART_SIZE = 67108864;

describe('videos-upload-parts', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let slug: string;

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
    ownerToken = await registerConfirmAndLogin(app, 'owner@example.com');
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Two parts',
        file_name: 'two.mp4',
        content_type: 'video/mp4',
        size_bytes: PART_SIZE * 2,
      });
    slug = res.body.video.slug;
  });

  const signParts = (token: string, partNumbers: number[]) =>
    request(app.getHttpServer())
      .post(`/videos/${slug}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: partNumbers });

  const listParts = (token: string) =>
    request(app.getHttpServer())
      .get(`/videos/${slug}/upload/parts`)
      .set('Authorization', `Bearer ${token}`);

  // 1. Upload parts
  test('signs-requested-parts', async () => {
    const res = await signParts(ownerToken, [1, 2]);

    expect(res.status).toBe(200);
    expect(
      res.body.parts.map((p: { part_number: number }) => p.part_number),
    ).toEqual([1, 2]);
    for (const part of res.body.parts)
      expect(part.url).toEqual(expect.any(String));
    expect(res.body.expires_in_seconds).toBe(3600);
  });

  test('uploaded-part-is-listed-for-resume', async () => {
    const signed = await signParts(ownerToken, [1]);
    const bytes = new Uint8Array(1024).fill(1);
    const put = await fetch(signed.body.parts[0].url, {
      method: 'PUT',
      body: bytes,
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();

    const res = await listParts(ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.parts).toEqual([
      { part_number: 1, etag, size_bytes: bytes.length },
    ]);
  });

  test('rejects-part-number-beyond-part-count', async () => {
    const res = await signParts(ownerToken, [3]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PART_NUMBER');
  });

  test('hides-video-from-other-users', async () => {
    const sign = await signParts(otherToken, [1]);
    expect(sign.status).toBe(404);
    expect(sign.body.error).toBe('VIDEO_NOT_FOUND');

    const list = await listParts(otherToken);
    expect(list.status).toBe(404);
    expect(list.body.error).toBe('VIDEO_NOT_FOUND');
  });

  test('rejects-non-draft-video', async () => {
    await dataSource
      .getRepository(Video)
      .update({ slug }, { status: 'processing' });

    const sign = await signParts(ownerToken, [1]);
    expect(sign.status).toBe(409);
    expect(sign.body.error).toBe('INVALID_VIDEO_STATE');

    const list = await listParts(ownerToken);
    expect(list.status).toBe(409);
    expect(list.body.error).toBe('INVALID_VIDEO_STATE');
  });
});
