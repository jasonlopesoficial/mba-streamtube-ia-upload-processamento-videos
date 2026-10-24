import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import videosConfig from '../config/videos.config';
import { QueueModule } from '../queue/queue.module';
import { obliterateQueue, useIsolatedQueuePrefix } from '../test/queue';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../video-processing/video-processing.constants';
import { Video } from './entities/video.entity';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideosModule } from './videos.module';

describe('VideoProcessingProducer (integration)', () => {
  let module: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue;
  let prefix: string;

  beforeAll(async () => {
    prefix = useIsolatedQueuePrefix();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, videosConfig],
        }),
        QueueModule,
        VideosModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .compile();
    producer = module.get(VideoProcessingProducer);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterEach(async () => {
    await obliterateQueue(queue);
  });

  afterAll(async () => {
    await queue.close();
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });

  it('should enqueue process-video with the video id as job id', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    expect(await job!.getState()).toBe('waiting');
  });

  it('should not duplicate the job when enqueued twice', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    expect(await queue.getWaitingCount()).toBe(1);
  });

  it('should keep test jobs out of the default prefix', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);

    const defaultQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: queue.opts.connection,
      prefix: 'streamtube',
    });
    expect(queue.opts.prefix).toBe(prefix);
    expect(await queue.getJob(videoId)).toBeDefined();
    expect(await defaultQueue.getJob(videoId)).toBeUndefined();
    await defaultQueue.close();
  });
});
