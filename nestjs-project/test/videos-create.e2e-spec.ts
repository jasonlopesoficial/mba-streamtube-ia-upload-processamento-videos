import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';

describe('videos-create', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let accessToken: string;

  const validBody = {
    title: 'Meu vídeo',
    file_name: 'movie.mp4',
    content_type: 'video/mp4',
    size_bytes: 10737418240,
  };

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
    accessToken = await registerConfirmAndLogin(app, 'creator@example.com');
  });

  // 1. POST /videos
  test('creates-draft-with-part-plan-for-10gib', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.video.status).toBe('draft');
    expect(res.body.video.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(res.body.upload).toEqual({ part_size: 67108864, part_count: 160 });
    expect(res.body.video.stream_url).toBeNull();
    expect(res.body.video.download_url).toBeNull();
    expect(res.body.video.thumbnail_url).toBeNull();

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: res.body.video.id });
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: row.channel_id });
    expect(channel.nickname).toBe('creator');
    expect(row.upload_id).not.toBeNull();
  });

  test('rejects-size-above-limit', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, size_bytes: 10737418241 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VIDEO_TOO_LARGE');
    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  test('rejects-non-video-content-type', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, content_type: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('requires-authentication', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .send(validBody);

    expect(res.status).toBe(401);
  });
});
