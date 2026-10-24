import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { MediaProbeService } from './media-probe.service';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingService } from './video-processing.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    VideosModule,
    StorageModule,
  ],
  providers: [
    MediaProbeService,
    VideoProcessingService,
    VideoProcessingProcessor,
  ],
})
export class VideoProcessingModule {}
