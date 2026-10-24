import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Channel } from './channels/entities/channel.entity';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import { VideoProcessingProcessor } from './video-processing/video-processing.processor';
import { VIDEO_PROCESSING_QUEUE } from './video-processing/video-processing.constants';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile with the video processing consumer', async () => {
    let builder = Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(getDataSourceToken())
      .useValue({})
      .overrideProvider(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .useValue({});
    for (const entity of [User, Channel, Video]) {
      builder = builder
        .overrideProvider(getRepositoryToken(entity))
        .useValue({});
    }
    const module = await builder.compile();

    expect(module.get(VideoProcessingProcessor)).toBeDefined();
    await module.close();
  });
});
