import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { thumbnailKey } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from '../videos/videos.constants';
import { VideosRepository } from '../videos/videos.repository';
import { MediaProbeError } from './media-probe.errors';
import { MediaProbeService } from './media-probe.service';

const THUMBNAIL_POSITION_RATIO = 0.1;
const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly mediaProbe: MediaProbeService,
  ) {}

  /**
   * Extracts duration/metadata, stores a thumbnail and marks the video ready.
   * Idempotent: videos not in `processing` are left untouched.
   */
  async process(videoId: string): Promise<void> {
    const video = await this.videosRepository.findById(videoId);
    if (!video || video.status !== VideoStatus.PROCESSING) {
      this.logger.warn(`Skipping video ${videoId}: not in processing`);
      return;
    }

    const source = await this.storageService.presignGetObject(
      video.storage_key,
    );
    try {
      const { durationSeconds, metadata } = await this.mediaProbe.probe(source);
      const at =
        durationSeconds < 1 ? 0 : durationSeconds * THUMBNAIL_POSITION_RATIO;
      const frame = await this.mediaProbe.captureFrame(source, at);

      const key = thumbnailKey(video.id);
      await this.storageService.putObject(key, frame, THUMBNAIL_CONTENT_TYPE);
      await this.videosRepository.transitionStatus(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        {
          duration_seconds: durationSeconds,
          metadata,
          thumbnail_key: key,
          processed_at: new Date(),
        },
      );
    } catch (err) {
      if (err instanceof MediaProbeError) {
        // Unreadable media will not get better on retry.
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  /** Final failure: store the reason and move `processing → failed`. */
  async markFailed(videoId: string, reason: string): Promise<void> {
    await this.videosRepository.transitionStatus(
      videoId,
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
      { processing_error: reason, processed_at: new Date() },
    );
  }
}
