import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

const PART_SIZE = 64 * 1024 * 1024;
const MAX_SIZE = 10 * 1024 * 1024 * 1024;

const dto = {
  title: 'Meu vídeo',
  file_name: 'movie.mp4',
  content_type: 'video/mp4',
  size_bytes: MAX_SIZE,
};

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-id',
    channel_id: 'channel-id',
    slug: 'AAAAAAAAAAA',
    title: dto.title,
    status: VideoStatus.DRAFT,
    original_filename: dto.file_name,
    content_type: dto.content_type,
    size_bytes: dto.size_bytes,
    storage_key: 'videos/video-id/source',
    upload_id: 'upload-1',
    thumbnail_key: null,
    duration_seconds: null,
    metadata: null,
    processing_error: null,
    processed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: { id: 'channel-id', user_id: 'user-1' } as Video['channel'],
    ...overrides,
  };
}

describe('VideosService', () => {
  let service: VideosService;
  let repository: jest.Mocked<VideosRepository>;
  let storage: jest.Mocked<StorageService>;
  let channels: jest.Mocked<ChannelsService>;

  beforeEach(async () => {
    repository = {
      createDraft: jest.fn(),
      findBySlugWithChannel: jest.fn(),
      findById: jest.fn(),
      transitionStatus: jest.fn(),
    } as unknown as jest.Mocked<VideosRepository>;
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageService>;
    channels = {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ id: 'channel-id', user_id: 'user-1' }),
    } as unknown as jest.Mocked<ChannelsService>;

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repository },
        { provide: StorageService, useValue: storage },
        { provide: ChannelsService, useValue: channels },
        {
          provide: videosConfig.KEY,
          useValue: { maxSizeBytes: MAX_SIZE, uploadPartSizeBytes: PART_SIZE },
        },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  describe('initiateUpload', () => {
    it('rejects files above the configured maximum without touching storage', async () => {
      await expect(
        service.initiateUpload('user-1', { ...dto, size_bytes: MAX_SIZE + 1 }),
      ).rejects.toBeInstanceOf(VideoTooLargeException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws CHANNEL_NOT_FOUND when the user has no channel', async () => {
      channels.findByUserId.mockResolvedValueOnce(null);

      await expect(
        service.initiateUpload('user-1', dto),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('aborts the multipart upload when persisting the draft fails', async () => {
      const failure = new Error('db down');
      repository.createDraft.mockRejectedValueOnce(failure);

      await expect(service.initiateUpload('user-1', dto)).rejects.toBe(failure);
      const [key] = storage.createMultipartUpload.mock.calls[0];
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        key,
        'upload-1',
      );
    });

    it('returns the draft and the part plan for a 10 GiB file', async () => {
      repository.createDraft.mockImplementationOnce((data) =>
        Promise.resolve(buildVideo({ ...data })),
      );

      const result = await service.initiateUpload('user-1', dto);

      expect(result.upload).toEqual({ part_size: PART_SIZE, part_count: 160 });
      expect(result.video.status).toBe(VideoStatus.DRAFT);
      const draft = repository.createDraft.mock.calls[0][0];
      expect(draft.storage_key).toBe(`videos/${draft.id}/source`);
      expect(draft).toMatchObject({
        channel_id: 'channel-id',
        upload_id: 'upload-1',
      });
    });

    it('rounds the part count up for partial last parts', async () => {
      repository.createDraft.mockImplementationOnce((data) =>
        Promise.resolve(buildVideo({ ...data })),
      );

      const result = await service.initiateUpload('user-1', {
        ...dto,
        size_bytes: PART_SIZE + 1,
      });

      expect(result.upload.part_count).toBe(2);
    });
  });
});
