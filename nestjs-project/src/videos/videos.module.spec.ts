import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import videosConfig from '../config/videos.config';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { Video } from './entities/video.entity';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideosModule } from './videos.module';

describe('VideosModule', () => {
  it('should compile with the repository and queue producer wired', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [videosConfig] }),
        VideosModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .overrideProvider(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .useValue({})
      .compile();

    expect(module.get(VideoProcessingProducer)).toBeDefined();
    await module.close();
  });
});
