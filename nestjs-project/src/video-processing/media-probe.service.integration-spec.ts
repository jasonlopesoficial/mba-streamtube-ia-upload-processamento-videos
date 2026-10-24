import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { createSampleVideo, SampleVideo } from '../test/sample-video';
import { MediaProbeError } from './media-probe.errors';
import { MediaProbeService } from './media-probe.service';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe('MediaProbeService (integration)', () => {
  let module: TestingModule;
  let probe: MediaProbeService;
  let storage: StorageService;
  let sample: SampleVideo;
  const key = `videos/${randomUUID()}/source`;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [videosConfig, storageConfig],
        }),
        StorageModule,
      ],
      providers: [MediaProbeService],
    }).compile();
    await module.init();
    probe = module.get(MediaProbeService);
    storage = module.get(StorageService);
    sample = await createSampleVideo(3);
    await storage.putObject(key, sample.bytes, 'video/mp4');
  }, 60000);

  afterAll(async () => {
    await storage.deleteObject(key);
    await sample.cleanup();
    await module.close();
  });

  it('extracts duration and stream metadata from a local file', async () => {
    const result = await probe.probe(sample.path);

    expect(result.durationSeconds).toBeCloseTo(3, 0);
    expect(result.metadata).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
    });
  });

  it('reads the same metadata from a presigned MinIO URL', async () => {
    const local = await probe.probe(sample.path);

    const remote = await probe.probe(await storage.presignGetObject(key));

    expect(remote).toEqual(local);
  });

  it('captures a JPEG frame', async () => {
    const frame = await probe.captureFrame(
      await storage.presignGetObject(key),
      1,
    );

    expect(frame.subarray(0, 3)).toEqual(JPEG_MAGIC);
  });

  it('rejects a file that is not a video', async () => {
    const junk = join(sample.path, '..', 'junk.mp4');
    await writeFile(junk, randomBytes(4096));

    await expect(probe.probe(junk)).rejects.toBeInstanceOf(MediaProbeError);
  });
});
