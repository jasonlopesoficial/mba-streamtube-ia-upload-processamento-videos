import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import {
  S3_CLIENT,
  S3_PRESIGN_CLIENT,
  S3_UPLOAD_REJECTION_CODES,
} from './storage.constants';
import { StorageUploadRejectedError } from './storage.errors';
import type {
  CompletedPart,
  ObjectHead,
  ObjectStream,
  StoredPart,
} from './storage.types';

function isUploadRejection(err: unknown): err is S3ServiceException {
  return (
    err instanceof S3ServiceException &&
    (S3_UPLOAD_REJECTION_CODES as readonly string[]).includes(err.name)
  );
}

@Injectable()
export class StorageService implements OnModuleInit {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Inject(S3_PRESIGN_CLIENT) private readonly presignClient: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    const Bucket = this.config.bucket;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
    } catch (err) {
      if (!(err instanceof NotFound) && !this.isStatus(err, 404)) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket }));
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) {
      throw new Error(`Storage returned no UploadId for ${key}`);
    }
    return res.UploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: this.config.presignExpirationSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of res.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber!,
          etag: part.ETag!,
          sizeBytes: part.Size ?? 0,
        });
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } catch (err) {
      if (isUploadRejection(err)) {
        throw new StorageUploadRejectedError(err.name, err.message);
      }
      throw err;
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(key: string): Promise<ObjectHead> {
    const res = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
  }

  async getObjectStream(key: string, range?: string): Promise<ObjectStream> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Range: range,
      }),
    );
    if (!(res.Body instanceof Readable)) {
      throw new Error(`Storage returned a non-stream body for ${key}`);
    }
    return {
      body: res.Body,
      contentLength: res.ContentLength ?? 0,
      contentRange: res.ContentRange,
    };
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  /** Short-lived GET URL on the internal endpoint (used by the worker's FFmpeg). */
  async presignGetObject(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: this.config.presignExpirationSeconds },
    );
  }

  private isStatus(err: unknown, status: number): boolean {
    return (
      err instanceof S3ServiceException &&
      err.$metadata?.httpStatusCode === status
    );
  }
}
