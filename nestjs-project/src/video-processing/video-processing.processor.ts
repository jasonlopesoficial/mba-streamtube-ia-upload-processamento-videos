import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import videosConfig from '../config/videos.config';
import {
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from './video-processing.constants';
import { VideoProcessingService } from './video-processing.service';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly processing: VideoProcessingService,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.workerConcurrency;
    this.logger.log(
      `Worker listening on queue "${VIDEO_PROCESSING_QUEUE}" (concurrency ${this.config.workerConcurrency})`,
    );
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    await this.processing.process(job.data.videoId);
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessingJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const finalAttempt =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error(
      `Job ${job.id} failed (attempt ${job.attemptsMade}${finalAttempt ? ', final' : ''}): ${error.message}`,
    );
    if (!finalAttempt) return;
    try {
      await this.processing.markFailed(job.data.videoId, error.message);
    } catch (err) {
      // Background context: log instead of crashing the worker.
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed: ${(err as Error).message}`,
      );
    }
  }
}
