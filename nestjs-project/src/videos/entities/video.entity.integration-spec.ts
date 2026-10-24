import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../videos.constants';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `video_owner_${++counter}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'owner',
      nickname: `owner_${counter}`,
      user_id: user.id,
    });
  });

  function buildVideo(overrides: Partial<Video> = {}): Partial<Video> {
    const id = randomUUID();
    return {
      id,
      channel_id: channel.id,
      slug: `slug${String(++counter).padStart(7, '0')}`,
      title: 'My video',
      original_filename: 'movie.mp4',
      content_type: 'video/mp4',
      size_bytes: 10737418240,
      storage_key: `videos/${id}/source`,
      ...overrides,
    };
  }

  it('should default status to draft', async () => {
    const saved = await videoRepository.save(buildVideo());
    const loaded = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(loaded.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce a unique slug', async () => {
    await videoRepository.save(buildVideo({ slug: 'AAAAAAAAAAA' }));

    await expect(
      videoRepository.save(buildVideo({ slug: 'AAAAAAAAAAA' })),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should reject a status outside the enum', async () => {
    const video = buildVideo();
    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("id", "channel_id", "slug", "title", "status", "original_filename", "content_type", "size_bytes", "storage_key")
         VALUES ($1, $2, $3, 'x', 'published', 'a.mp4', 'video/mp4', 1, 'k')`,
        [video.id, channel.id, video.slug],
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should cascade-delete videos when the channel is removed', async () => {
    const saved = await videoRepository.save(buildVideo());

    await dataSource.getRepository(Channel).delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });

  it('should read bigint and numeric columns as numbers', async () => {
    const saved = await videoRepository.save(
      buildVideo({ duration_seconds: 12.345 }),
    );
    const loaded = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(loaded.size_bytes).toBe(10737418240);
    expect(loaded.duration_seconds).toBe(12.345);
  });

  it('should keep optional processing columns nullable', async () => {
    const saved = await videoRepository.save(buildVideo());
    const loaded = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(loaded).toMatchObject({
      upload_id: null,
      thumbnail_key: null,
      duration_seconds: null,
      metadata: null,
      processing_error: null,
      processed_at: null,
    });
  });
});
