import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../src/test/queue';
import { Video } from '../src/videos/entities/video.entity';
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

describe('videos-download', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let token: string;
  let slug: string;
  const file = randomBytes(64 * 1024);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    randomBytes(128),
  ]);

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
    token = await registerConfirmAndLogin(app, 'downloader@example.com');
    const uploaded = await startAndUploadParts(app, token, file, {
      fileName: 'meu vídeo.mp4',
    });
    expect((await completeUpload(app, token, uploaded)).status).toBe(202);
    const thumbnailKey = `thumbnails/${uploaded.id}.jpg`;
    await app.get(StorageService).putObject(thumbnailKey, jpeg, 'image/jpeg');
    await dataSource
      .getRepository(Video)
      .update(
        { id: uploaded.id },
        { status: 'ready', thumbnail_key: thumbnailKey },
      );
    slug = uploaded.slug;
  });

  // 1. Download and thumbnail
  test('download-returns-attachment-with-original-bytes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/videos/${slug}/download`)
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).toContain(
      "filename*=UTF-8''meu%20v%C3%ADdeo.mp4",
    );
    expect(res.body).toEqual(file);
  });

  test('thumbnail-returns-jpeg', async () => {
    const res = await request(app.getHttpServer())
      .get(`/videos/${slug}/thumbnail`)
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect((res.body as Buffer).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  test('draft-video-is-not-found', async () => {
    const draft = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Draft',
        file_name: 'd.mp4',
        content_type: 'video/mp4',
        size_bytes: 10,
      });
    const draftSlug = draft.body.video.slug;

    const download = await request(app.getHttpServer()).get(
      `/videos/${draftSlug}/download`,
    );
    expect(download.status).toBe(404);
    expect(download.body.error).toBe('VIDEO_NOT_FOUND');

    const thumbnail = await request(app.getHttpServer()).get(
      `/videos/${draftSlug}/thumbnail`,
    );
    expect(thumbnail.status).toBe(404);
    expect(thumbnail.body.error).toBe('VIDEO_NOT_FOUND');
  });
});
