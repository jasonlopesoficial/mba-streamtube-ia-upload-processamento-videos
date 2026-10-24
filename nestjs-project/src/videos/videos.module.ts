import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { Video } from './entities/video.entity';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideosRepository } from './videos.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  providers: [VideosRepository, VideoProcessingProducer],
  exports: [VideosRepository],
})
export class VideosModule {}
