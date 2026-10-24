import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { obliterateQueue, useIsolatedQueuePrefix } from '../test/queue';
import { User } from '../users/entities/user.entity';
import { createStoredVideo } from '../test/video-fixtures';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { UsersModule } from '../users/users.module';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let storage: StorageService;
  let queue: Queue;
  let owner: User;
  let counter = 0;

  beforeAll(async () => {
    useIsolatedQueuePrefix();
    module = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        DatabaseModule,
        QueueModule,
        // Registers User, which Channel (loaded by VideosModule) relates to.
        UsersModule,
        VideosModule,
      ],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    storage = module.get(StorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await obliterateQueue(queue);
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createUserWithChannel();
  });

  async function createUserWithChannel(): Promise<User> {
    const user = await dataSource.getRepository(User).save({
      email: `videos_it_${++counter}@example.com`,
      password: 'hashed',
      is_confirmed: true,
    });
    await dataSource.getRepository(Channel).save({
      name: 'owner',
      nickname: `videos_it_${counter}`,
      user_id: user.id,
    });
    return user;
  }

  async function readAll(body: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function ownerChannel(): Promise<Channel> {
    return dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.id });
  }

  const dto = {
    title: 'Meu vídeo',
    file_name: 'movie.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
  };

  describe('initiateUpload', () => {
    it('persists a draft in the user channel with an open multipart upload', async () => {
      const result = await service.initiateUpload(owner.id, dto);

      const row = await dataSource.getRepository(Video).findOneOrFail({
        where: { id: result.video.id },
        relations: { channel: true },
      });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.channel.user_id).toBe(owner.id);
      expect(row.upload_id).not.toBeNull();
      expect(row.storage_key).toBe(`videos/${row.id}/source`);
      await expect(
        storage.listParts(row.storage_key, row.upload_id!),
      ).resolves.toEqual([]);
    });
  });

  describe('signUploadParts / listUploadedParts', () => {
    it('stores a part sent to the signed URL and lists it for resume', async () => {
      const { video } = await service.initiateUpload(owner.id, dto);
      const bytes = Buffer.alloc(dto.size_bytes, 7);

      const { parts } = await service.signUploadParts(
        video.slug,
        owner.id,
        [1],
      );
      const put = await fetch(parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(bytes),
      });
      expect(put.status).toBe(200);

      await expect(
        service.listUploadedParts(video.slug, owner.id),
      ).resolves.toEqual({
        parts: [
          {
            part_number: 1,
            etag: put.headers.get('etag'),
            size_bytes: bytes.length,
          },
        ],
      });
    });
  });

  describe('completeUpload', () => {
    it('stores the object, moves to processing and enqueues process-video', async () => {
      const { video } = await service.initiateUpload(owner.id, dto);
      const { parts } = await service.signUploadParts(
        video.slug,
        owner.id,
        [1],
      );
      const put = await fetch(parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(dto.size_bytes),
      });

      const result = await service.completeUpload(video.slug, owner.id, [
        { part_number: 1, etag: put.headers.get('etag')! },
      ]);

      expect(result.status).toBe(VideoStatus.PROCESSING);
      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(row.upload_id).toBeNull();
      await expect(storage.headObject(row.storage_key)).resolves.toMatchObject({
        sizeBytes: dto.size_bytes,
      });
      const job = await queue.getJob(video.id);
      expect(job?.data).toEqual({ videoId: video.id });
    });
  });

  describe('openStream', () => {
    it('returns the exact requested byte range from storage', async () => {
      const bytes = randomBytes(4096);
      const video = await createStoredVideo(
        dataSource,
        storage,
        await ownerChannel(),
        bytes,
        VideoStatus.READY,
      );

      const delivery = await service.openStream(video.slug, 'bytes=100-1123');

      expect(delivery.statusCode).toBe(206);
      expect(delivery.headers).toMatchObject({
        'Content-Range': `bytes 100-1123/${bytes.length}`,
        'Content-Length': '1024',
        'Accept-Ranges': 'bytes',
      });
      expect(await readAll(delivery.body)).toEqual(bytes.subarray(100, 1124));
    });

    it('treats videos that are not ready as not found', async () => {
      const video = await createStoredVideo(
        dataSource,
        storage,
        await ownerChannel(),
        randomBytes(64),
        VideoStatus.PROCESSING,
      );

      await expect(
        service.openStream(video.slug, undefined),
      ).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
      });
    });
  });
});
