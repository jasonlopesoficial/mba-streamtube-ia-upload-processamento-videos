import { randomBytes } from 'node:crypto';
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
import { createSampleVideo, SampleVideo } from '../test/sample-video';
import { createChannelOwner, createStoredVideo } from '../test/video-fixtures';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingProducer } from '../videos/video-processing.producer';
import { VideoStatus } from '../videos/videos.constants';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoProcessingModule } from './video-processing.module';

async function waitForStatus(
  dataSource: DataSource,
  id: string,
  expected: VideoStatus,
  timeoutMs = 30000,
): Promise<Video> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await dataSource.getRepository(Video).findOneByOrFail({ id });
    if (row.status === expected) return row;
    if (Date.now() > deadline) {
      throw new Error(`Video ${id} stayed ${row.status}, expected ${expected}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('VideoProcessingProcessor (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let producer: VideoProcessingProducer;
  let queue: Queue;
  let sample: SampleVideo;
  let channel: Channel;

  beforeAll(async () => {
    useIsolatedQueuePrefix();
    module = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        DatabaseModule,
        QueueModule,
        UsersModule,
        VideoProcessingModule,
      ],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    producer = module.get(VideoProcessingProducer, { strict: false });
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE), {
      strict: false,
    });
    sample = await createSampleVideo(3);
  }, 60000);

  afterAll(async () => {
    await obliterateQueue(queue);
    await sample.cleanup();
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    channel = await createChannelOwner(dataSource);
  });

  it('consumes process-video and leaves the video ready', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      sample.bytes,
    );

    await producer.enqueue(video.id);

    const row = await waitForStatus(dataSource, video.id, VideoStatus.READY);
    expect(row.thumbnail_key).toBe(`thumbnails/${video.id}.jpg`);
    expect(row.duration_seconds).toBeGreaterThan(0);
  });

  it('fails unreadable media without further attempts', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      randomBytes(4096),
    );

    await producer.enqueue(video.id);

    const row = await waitForStatus(dataSource, video.id, VideoStatus.FAILED);
    expect(row.processing_error).toEqual(expect.any(String));
    const job = await queue.getJob(video.id);
    expect(job?.attemptsMade).toBe(1);
  });
});
