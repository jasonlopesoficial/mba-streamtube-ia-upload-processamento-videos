import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import videosConfig from '../config/videos.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from '../video-processing/video-processing.constants';

const FAILED_JOBS_KEPT = 1000;

@Injectable()
export class VideoProcessingProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessingJobData>,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      {
        jobId: videoId,
        attempts: this.config.processingAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.processingBackoffMs,
        },
        removeOnComplete: true,
        removeOnFail: FAILED_JOBS_KEPT,
      },
    );
  }
}
