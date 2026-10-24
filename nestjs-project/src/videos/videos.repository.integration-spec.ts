import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import videosConfig from '../config/videos.config';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { Video } from './entities/video.entity';
import * as slugUtil from './slug.util';
import { MAX_SLUG_ATTEMPTS, VideoStatus } from './videos.constants';
import { NewDraftVideo, VideosRepository } from './videos.repository';
import { VideosModule } from './videos.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosRepository (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let repository: VideosRepository;
  let channel: Channel;
  let counter = 0;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [videosConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    })
      .overrideProvider(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .useValue({})
      .compile();
    dataSource = module.get(DataSource);
    repository = module.get(VideosRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `repo_owner_${++counter}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'owner',
      nickname: `repo_owner_${counter}`,
      user_id: user.id,
    });
  });

  function draftData(): NewDraftVideo {
    const id = randomUUID();
    return {
      id,
      channel_id: channel.id,
      title: 'My video',
      original_filename: 'movie.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${id}/source`,
      upload_id: 'upload-1',
    };
  }

  it('should persist a draft with an 11-char slug', async () => {
    const saved = await repository.createDraft(draftData());

    expect(saved.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(await repository.findById(saved.id)).toMatchObject({
      upload_id: 'upload-1',
      channel_id: channel.id,
    });
  });

  it('should retry with a new slug when the first one collides', async () => {
    const existing = await repository.createDraft(draftData());
    jest
      .spyOn(slugUtil, 'generateVideoSlug')
      .mockReturnValueOnce(existing.slug)
      .mockReturnValueOnce('FRESHslug01');

    const saved = await repository.createDraft(draftData());

    expect(saved.slug).toBe('FRESHslug01');
  });

  it('should fail after exhausting slug attempts', async () => {
    const existing = await repository.createDraft(draftData());
    const spy = jest
      .spyOn(slugUtil, 'generateVideoSlug')
      .mockReturnValue(existing.slug);

    await expect(repository.createDraft(draftData())).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(spy).toHaveBeenCalledTimes(MAX_SLUG_ATTEMPTS);
  });

  it('should load the channel together with the video by slug', async () => {
    const saved = await repository.createDraft(draftData());

    const loaded = await repository.findBySlugWithChannel(saved.slug);

    expect(loaded?.channel.user_id).toBe(channel.user_id);
    expect(await repository.findBySlugWithChannel('missingslug')).toBeNull();
  });

  it('should transition only from the expected status', async () => {
    const saved = await repository.createDraft(draftData());

    await expect(
      repository.transitionStatus(
        saved.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { upload_id: null },
      ),
    ).resolves.toBe(true);
    await expect(
      repository.transitionStatus(
        saved.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
      ),
    ).resolves.toBe(false);

    expect(await repository.findById(saved.id)).toMatchObject({
      status: VideoStatus.PROCESSING,
      upload_id: null,
    });
  });

  it('should not move a ready video back to processing', async () => {
    const saved = await repository.createDraft(draftData());
    await dataSource
      .getRepository(Video)
      .update(saved.id, { status: VideoStatus.READY });

    await expect(
      repository.transitionStatus(
        saved.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
      ),
    ).resolves.toBe(false);
    expect((await repository.findById(saved.id))?.status).toBe(
      VideoStatus.READY,
    );
  });
});
