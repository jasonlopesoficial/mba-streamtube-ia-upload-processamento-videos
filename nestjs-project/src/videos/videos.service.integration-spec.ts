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
});
