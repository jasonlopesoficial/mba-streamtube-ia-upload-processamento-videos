import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import videosConfig from '../config/videos.config';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile with repository, producer, service and controller wired', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [videosConfig, storageConfig],
        }),
        VideosModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .overrideProvider(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .useValue({})
      .overrideProvider(getRepositoryToken(Channel))
      .useValue({})
      .overrideProvider(ChannelsService)
      .useValue({})
      .overrideProvider(StorageService)
      .useValue({})
      .compile();

    expect(module.get(VideoProcessingProducer)).toBeDefined();
    expect(module.get(VideosService)).toBeDefined();
    await module.close();
  });
});
