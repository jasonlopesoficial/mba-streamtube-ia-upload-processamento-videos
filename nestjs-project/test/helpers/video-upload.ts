import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

export interface UploadedVideo {
  id: string;
  slug: string;
  parts: { part_number: number; etag: string }[];
}

/**
 * Drives the direct-to-storage upload: `POST /videos`, signs every part,
 * `PUT`s each slice to its presigned URL. Does not complete the upload.
 */
export async function startAndUploadParts(
  app: INestApplication<App>,
  token: string,
  file: Buffer,
  options: { fileName?: string; declaredSize?: number; title?: string } = {},
): Promise<UploadedVideo> {
  const created = await request(app.getHttpServer())
    .post('/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: options.title ?? 'Test video',
      file_name: options.fileName ?? 'sample.mp4',
      content_type: 'video/mp4',
      size_bytes: options.declaredSize ?? file.length,
    })
    .expect(201);
  const { video, upload } = created.body as {
    video: { id: string; slug: string };
    upload: { part_size: number; part_count: number };
  };

  const partNumbers = Array.from(
    { length: upload.part_count },
    (_, i) => i + 1,
  );
  const signed = await request(app.getHttpServer())
    .post(`/videos/${video.slug}/upload/parts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ part_numbers: partNumbers })
    .expect(200);

  const parts: UploadedVideo['parts'] = [];
  const signedParts = (
    signed.body as { parts: { part_number: number; url: string }[] }
  ).parts;
  for (const { part_number, url } of signedParts) {
    const start = (part_number - 1) * upload.part_size;
    const slice = file.subarray(start, start + upload.part_size);
    if (slice.length === 0) continue;
    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(slice),
    });
    if (put.status !== 200) {
      throw new Error(`Part ${part_number} upload failed with ${put.status}`);
    }
    parts.push({ part_number, etag: put.headers.get('etag')! });
  }
  return { id: video.id, slug: video.slug, parts };
}

export async function completeUpload(
  app: INestApplication<App>,
  token: string,
  uploaded: UploadedVideo,
): Promise<request.Response> {
  return request(app.getHttpServer())
    .post(`/videos/${uploaded.slug}/upload/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ parts: uploaded.parts });
}
