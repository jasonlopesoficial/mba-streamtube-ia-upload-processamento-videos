import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { isUniqueViolationOn } from '../common/database/pg-errors';
import { Video } from './entities/video.entity';
import { generateVideoSlug } from './slug.util';
import {
  MAX_SLUG_ATTEMPTS,
  SLUG_COLUMN,
  VideoStatus,
} from './videos.constants';

export type NewDraftVideo = Pick<
  Video,
  | 'id'
  | 'channel_id'
  | 'title'
  | 'original_filename'
  | 'content_type'
  | 'size_bytes'
  | 'storage_key'
  | 'upload_id'
>;

export type VideoChanges = QueryDeepPartialEntity<Video>;

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly repository: Repository<Video>,
  ) {}

  /** Inserts a draft video, regenerating the slug on unique collisions. */
  async createDraft(data: NewDraftVideo): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.repository.save(
          this.repository.create({
            ...data,
            slug: generateVideoSlug(),
            status: VideoStatus.DRAFT,
          }),
        );
      } catch (err) {
        if (
          !isUniqueViolationOn(err, SLUG_COLUMN) ||
          attempt >= MAX_SLUG_ATTEMPTS
        ) {
          throw err;
        }
      }
    }
  }

  async findBySlugWithChannel(slug: string): Promise<Video | null> {
    return this.repository.findOne({
      where: { slug },
      relations: { channel: true },
    });
  }

  async findById(id: string): Promise<Video | null> {
    return this.repository.findOneBy({ id });
  }

  /**
   * Atomically moves a video from `from` to `to` (optionally applying extra
   * column changes). Returns false when the video was not in `from`.
   */
  async transitionStatus(
    id: string,
    from: VideoStatus,
    to: VideoStatus,
    changes: VideoChanges = {},
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Video)
      .set({ ...changes, status: to })
      .where('id = :id AND status = :from', { id, from })
      .execute();
    return result.affected === 1;
  }
}
