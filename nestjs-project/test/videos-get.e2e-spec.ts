import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { Video } from '../src/videos/entities/video.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/app';

describe('videos-get', () => {
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
        title: 'Detail',
        file_name: 'detail.mp4',
        content_type: 'video/mp4',
        size_bytes: 2048,
      });
    slug = res.body.video.slug;
  });

  const getVideo = (token?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${slug}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Owner video detail
  test('draft-has-no-delivery-links', async () => {
    const res = await getVideo(ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.stream_url).toBeNull();
    expect(res.body.download_url).toBeNull();
    expect(res.body.thumbnail_url).toBeNull();
  });

  test('ready-exposes-metadata-and-links', async () => {
    await dataSource.getRepository(Video).update(
      { slug },
      {
        status: 'ready',
        duration_seconds: 12.5,
        metadata: {
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          bit_rate: 1000,
          width: 320,
          height: 240,
          video_codec: 'h264',
          audio_codec: 'aac',
        },
        thumbnail_key: 'thumbnails/x.jpg',
      },
    );

    const res = await getVideo(ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.duration_seconds).toBe(12.5);
    expect(res.body.metadata).toMatchObject({
      width: 320,
      video_codec: 'h264',
    });
    expect(res.body.stream_url).toBe(`/videos/${slug}/stream`);
    expect(res.body.download_url).toBe(`/videos/${slug}/download`);
    expect(res.body.thumbnail_url).toBe(`/videos/${slug}/thumbnail`);
  });

  test('failed-exposes-processing-error', async () => {
    await dataSource
      .getRepository(Video)
      .update(
        { slug },
        { status: 'failed', processing_error: 'No video stream found' },
      );

    const res = await getVideo(ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.processing_error).toBe('No video stream found');
  });

  test('other-user-and-anonymous-are-denied', async () => {
    const other = await getVideo(otherToken);
    expect(other.status).toBe(404);
    expect(other.body.error).toBe('VIDEO_NOT_FOUND');

    const anonymous = await getVideo();
    expect(anonymous.status).toBe(401);
  });
});
