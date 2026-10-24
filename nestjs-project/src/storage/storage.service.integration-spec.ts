import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';
import { StorageUploadRejectedError } from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const TEST_BUCKET = `streamtube-storage-spec-${randomUUID().slice(0, 8)}`;
const MIN_PART_SIZE = 5 * 1024 * 1024;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

async function putPart(url: string, body: Buffer): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
  expect(res.status).toBe(200);
  return res.headers.get('etag')!;
}

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let client: S3Client;
  const originalBucket = process.env.S3_BUCKET;

  beforeAll(async () => {
    process.env.S3_BUCKET = TEST_BUCKET;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await module.init();
    storage = module.get(StorageService);
    client = module.get(S3_CLIENT);
  });

  afterAll(async () => {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: TEST_BUCKET }),
    );
    if (listed.Contents?.length) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: TEST_BUCKET,
          Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key })) },
        }),
      );
    }
    await client.send(new DeleteBucketCommand({ Bucket: TEST_BUCKET }));
    await module.close();
    process.env.S3_BUCKET = originalBucket;
  });

  it('should create the configured bucket on module init', async () => {
    await expect(
      client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET })),
    ).resolves.toBeDefined();
  });

  it('should complete a two-part upload sent through presigned URLs', async () => {
    const key = `videos/${randomUUID()}/source`;
    const part1 = randomBytes(MIN_PART_SIZE);
    const part2 = randomBytes(1024);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    const url1 = await storage.presignUploadPart(key, uploadId, 1);
    const url2 = await storage.presignUploadPart(key, uploadId, 2);
    const etag1 = await putPart(url1, part1);
    const etag2 = await putPart(url2, part2);

    const listed = await storage.listParts(key, uploadId);
    expect(listed).toEqual([
      { partNumber: 1, etag: etag1, sizeBytes: part1.length },
      { partNumber: 2, etag: etag2, sizeBytes: part2.length },
    ]);

    await storage.completeMultipartUpload(key, uploadId, [
      { partNumber: 2, etag: etag2 },
      { partNumber: 1, etag: etag1 },
    ]);

    const head = await storage.headObject(key);
    expect(head).toEqual({
      sizeBytes: part1.length + part2.length,
      contentType: 'video/mp4',
    });

    const ranged = await storage.getObjectStream(key, 'bytes=0-9');
    expect(ranged.contentLength).toBe(10);
    expect(ranged.contentRange).toBe(
      `bytes 0-9/${part1.length + part2.length}`,
    );
    expect(await readAll(ranged.body)).toEqual(part1.subarray(0, 10));
  });

  it('should sign part URLs for the public endpoint host', async () => {
    const key = `videos/${randomUUID()}/source`;
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const url = new URL(await storage.presignUploadPart(key, uploadId, 1));
    const publicEndpoint = new URL(
      process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT!,
    );

    expect(url.host).toBe(publicEndpoint.host);
    await storage.abortMultipartUpload(key, uploadId);
  });

  it('should reject completion with an invalid ETag', async () => {
    const key = `videos/${randomUUID()}/source`;
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    await putPart(
      await storage.presignUploadPart(key, uploadId, 1),
      randomBytes(512),
    );

    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
      ]),
    ).rejects.toBeInstanceOf(StorageUploadRejectedError);
    await storage.abortMultipartUpload(key, uploadId);
  });

  it('should put, read and delete a whole object', async () => {
    const key = `thumbnails/${randomUUID()}.jpg`;
    const body = randomBytes(2048);
    await storage.putObject(key, body, 'image/jpeg');

    const whole = await storage.getObjectStream(key);
    expect(whole.contentLength).toBe(body.length);
    expect(await readAll(whole.body)).toEqual(body);

    await storage.deleteObject(key);
    await expect(storage.headObject(key)).rejects.toBeDefined();
  });

  it('should presign an internal GET URL readable over HTTP', async () => {
    const key = `thumbnails/${randomUUID()}.jpg`;
    const body = randomBytes(256);
    await storage.putObject(key, body, 'image/jpeg');

    const res = await fetch(await storage.presignGetObject(key));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
  });
});
