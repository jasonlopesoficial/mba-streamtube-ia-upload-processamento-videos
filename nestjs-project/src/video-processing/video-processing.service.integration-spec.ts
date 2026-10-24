import { randomBytes } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { useIsolatedQueuePrefix } from '../test/queue';
import { createSampleVideo, SampleVideo } from '../test/sample-video';
import { createChannelOwner, createStoredVideo } from '../test/video-fixtures';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessingService } from './video-processing.service';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe('VideoProcessingService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let service: VideoProcessingService;
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
    service = module.get(VideoProcessingService);
    sample = await createSampleVideo(3);
  }, 60000);

  afterAll(async () => {
    await sample.cleanup();
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    channel = await createChannelOwner(dataSource);
  });

  const reload = (id: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  it('marks a processing video ready with metadata and a stored thumbnail', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      sample.bytes,
    );

    await service.process(video.id);

    const row = await reload(video.id);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeCloseTo(3, 0);
    expect(row.metadata).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
    });
    expect(row.thumbnail_key).toBe(`thumbnails/${video.id}.jpg`);
    expect(row.processed_at).not.toBeNull();

    const thumb = await storage.getObjectStream(row.thumbnail_key!);
    const chunks: Buffer[] = [];
    for await (const chunk of thumb.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).subarray(0, 3)).toEqual(JPEG_MAGIC);
  });

  it('leaves videos that are not processing untouched', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      sample.bytes,
      VideoStatus.READY,
    );

    await service.process(video.id);

    const row = await reload(video.id);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.thumbnail_key).toBeNull();
  });

  it('raises UnrecoverableError for unreadable media', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      randomBytes(4096),
    );

    await expect(service.process(video.id)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect((await reload(video.id)).status).toBe(VideoStatus.PROCESSING);
  });

  it('markFailed stores the reason and moves processing to failed', async () => {
    const video = await createStoredVideo(
      dataSource,
      storage,
      channel,
      sample.bytes,
    );

    await service.markFailed(video.id, 'boom');

    const row = await reload(video.id);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.processing_error).toBe('boom');
  });
});
