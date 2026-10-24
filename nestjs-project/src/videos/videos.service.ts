import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidPartNumberException,
  InvalidVideoStateException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { videoSourceKey } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { CreateVideoResponseDto } from './dto/create-video-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import {
  SignedUploadPartsResponseDto,
  UploadedPartsResponseDto,
} from './dto/upload-parts-response.dto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosRepository } from './videos.repository';

@Injectable()
export class VideosService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  /** Pre-registers a draft video and opens its multipart upload in storage. */
  async initiateUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    if (dto.size_bytes > this.config.maxSizeBytes) {
      throw new VideoTooLargeException(this.config.maxSizeBytes);
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const id = randomUUID();
    const storageKey = videoSourceKey(id);
    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.content_type,
    );

    let video: Video;
    try {
      video = await this.videosRepository.createDraft({
        id,
        channel_id: channel.id,
        title: dto.title,
        original_filename: dto.file_name,
        content_type: dto.content_type,
        size_bytes: dto.size_bytes,
        storage_key: storageKey,
        upload_id: uploadId,
      });
    } catch (err) {
      // Do not leave an orphan multipart upload behind.
      await this.storageService.abortMultipartUpload(storageKey, uploadId);
      throw err;
    }

    const partSize = this.config.uploadPartSizeBytes;
    return {
      video: VideoResponseDto.fromEntity(video),
      upload: {
        part_size: partSize,
        part_count: this.partCount(dto.size_bytes),
      },
    };
  }

  /** Presigned part URLs for the owner's draft (also used to resume uploads). */
  async signUploadParts(
    slug: string,
    userId: string,
    partNumbers: number[],
  ): Promise<SignedUploadPartsResponseDto> {
    const video = await this.findOwnedDraft(slug, userId);
    const partCount = this.partCount(video.size_bytes);
    if (partNumbers.some((n) => n > partCount)) {
      throw new InvalidPartNumberException(partCount);
    }

    const parts = await Promise.all(
      [...partNumbers]
        .sort((a, b) => a - b)
        .map(async (partNumber) => ({
          part_number: partNumber,
          url: await this.storageService.presignUploadPart(
            video.storage_key,
            video.upload_id!,
            partNumber,
          ),
        })),
    );
    return { parts, expires_in_seconds: this.storage.presignExpirationSeconds };
  }

  /** Parts already stored for the owner's draft, so a client can resume. */
  async listUploadedParts(
    slug: string,
    userId: string,
  ): Promise<UploadedPartsResponseDto> {
    const video = await this.findOwnedDraft(slug, userId);
    const parts = await this.storageService.listParts(
      video.storage_key,
      video.upload_id!,
    );
    return {
      parts: parts.map((p) => ({
        part_number: p.partNumber,
        etag: p.etag,
        size_bytes: p.sizeBytes,
      })),
    };
  }

  private partCount(sizeBytes: number): number {
    return Math.ceil(sizeBytes / this.config.uploadPartSizeBytes);
  }

  private async findOwnedVideo(slug: string, userId: string): Promise<Video> {
    const video = await this.videosRepository.findBySlugWithChannel(slug);
    if (!video || video.channel.user_id !== userId) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async findOwnedDraft(slug: string, userId: string): Promise<Video> {
    const video = await this.findOwnedVideo(slug, userId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStateException(video.status);
    }
    return video;
  }
}
