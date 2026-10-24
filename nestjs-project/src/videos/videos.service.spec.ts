import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidPartNumberException,
  InvalidVideoStateException,
  UploadIncompleteException,
  UploadSizeMismatchException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { StorageUploadRejectedError } from '../storage/storage.errors';
import { VideoProcessingProducer } from './video-processing.producer';
import storageConfig from '../config/storage.config';
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
  let producer: jest.Mocked<VideoProcessingProducer>;

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
      presignUploadPart: jest.fn((_k: string, _u: string, n: number) =>
        Promise.resolve(`https://storage/part-${n}`),
      ),
      listParts: jest.fn().mockResolvedValue([]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue({ sizeBytes: 1024 }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageService>;
    channels = {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ id: 'channel-id', user_id: 'user-1' }),
    } as unknown as jest.Mocked<ChannelsService>;

    producer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoProcessingProducer>;

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repository },
        { provide: StorageService, useValue: storage },
        { provide: ChannelsService, useValue: channels },
        { provide: VideoProcessingProducer, useValue: producer },
        {
          provide: videosConfig.KEY,
          useValue: { maxSizeBytes: MAX_SIZE, uploadPartSizeBytes: PART_SIZE },
        },
        {
          provide: storageConfig.KEY,
          useValue: { presignExpirationSeconds: 3600 },
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

  describe('signUploadParts / listUploadedParts', () => {
    const twoParts = buildVideo({ size_bytes: PART_SIZE * 2 });

    it('signs the requested parts of the owner draft in order', async () => {
      repository.findBySlugWithChannel.mockResolvedValueOnce(twoParts);

      const result = await service.signUploadParts(
        twoParts.slug,
        'user-1',
        [2, 1],
      );

      expect(result).toEqual({
        parts: [
          { part_number: 1, url: 'https://storage/part-1' },
          { part_number: 2, url: 'https://storage/part-2' },
        ],
        expires_in_seconds: 3600,
      });
    });

    it('rejects part numbers beyond part_count', async () => {
      repository.findBySlugWithChannel.mockResolvedValueOnce(twoParts);

      await expect(
        service.signUploadParts(twoParts.slug, 'user-1', [3]),
      ).rejects.toBeInstanceOf(InvalidPartNumberException);
    });

    it('hides videos of other channels as not found', async () => {
      repository.findBySlugWithChannel.mockResolvedValue(twoParts);

      await expect(
        service.signUploadParts(twoParts.slug, 'intruder', [1]),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      await expect(
        service.listUploadedParts(twoParts.slug, 'intruder'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('rejects unknown slugs as not found', async () => {
      repository.findBySlugWithChannel.mockResolvedValueOnce(null);

      await expect(
        service.listUploadedParts('missingslug', 'user-1'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('rejects videos that are not drafts', async () => {
      repository.findBySlugWithChannel.mockResolvedValue(
        buildVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
      );

      await expect(
        service.signUploadParts('AAAAAAAAAAA', 'user-1', [1]),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
      await expect(
        service.listUploadedParts('AAAAAAAAAAA', 'user-1'),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
    });

    it('maps stored parts to the response shape', async () => {
      repository.findBySlugWithChannel.mockResolvedValueOnce(twoParts);
      storage.listParts.mockResolvedValueOnce([
        { partNumber: 1, etag: '"e1"', sizeBytes: PART_SIZE },
      ]);

      await expect(
        service.listUploadedParts(twoParts.slug, 'user-1'),
      ).resolves.toEqual({
        parts: [{ part_number: 1, etag: '"e1"', size_bytes: PART_SIZE }],
      });
    });
  });

  describe('completeUpload', () => {
    const draft = buildVideo({ size_bytes: 1024 });
    const parts = [{ part_number: 1, etag: '"e1"' }];

    beforeEach(() => {
      repository.findBySlugWithChannel.mockResolvedValue(draft);
      repository.transitionStatus.mockResolvedValue(true);
      repository.findById.mockResolvedValue(
        buildVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
      );
    });

    it('moves the video to processing and enqueues the job', async () => {
      const result = await service.completeUpload(draft.slug, 'user-1', parts);

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        draft.storage_key,
        draft.upload_id,
        [{ partNumber: 1, etag: '"e1"' }],
      );
      expect(repository.transitionStatus).toHaveBeenCalledWith(
        draft.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { upload_id: null },
      );
      expect(producer.enqueue).toHaveBeenCalledWith(draft.id);
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('maps storage rejections to UPLOAD_INCOMPLETE and keeps the draft', async () => {
      storage.completeMultipartUpload.mockRejectedValueOnce(
        new StorageUploadRejectedError('InvalidPart', 'bad etag'),
      );

      await expect(
        service.completeUpload(draft.slug, 'user-1', parts),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(repository.transitionStatus).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('fails the video and deletes the object on size mismatch', async () => {
      storage.headObject.mockResolvedValueOnce({
        sizeBytes: 10,
        contentType: 'video/mp4',
      });

      await expect(
        service.completeUpload(draft.slug, 'user-1', parts),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);
      expect(storage.deleteObject).toHaveBeenCalledWith(draft.storage_key);
      expect(repository.transitionStatus).toHaveBeenCalledWith(
        draft.id,
        VideoStatus.DRAFT,
        VideoStatus.FAILED,
        expect.objectContaining({ processing_error: expect.any(String) }),
      );
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('rejects when a concurrent request already moved the video', async () => {
      repository.transitionStatus.mockResolvedValueOnce(false);

      await expect(
        service.completeUpload(draft.slug, 'user-1', parts),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('fails the video when the job cannot be enqueued', async () => {
      const failure = new Error('redis down');
      producer.enqueue.mockRejectedValueOnce(failure);

      await expect(
        service.completeUpload(draft.slug, 'user-1', parts),
      ).rejects.toBe(failure);
      expect(repository.transitionStatus).toHaveBeenLastCalledWith(
        draft.id,
        VideoStatus.PROCESSING,
        VideoStatus.FAILED,
        expect.objectContaining({ processing_error: expect.any(String) }),
      );
    });
  });
});
