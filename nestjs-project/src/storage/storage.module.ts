import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3_CLIENT, S3_PRESIGN_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

function createS3Client(
  cfg: ConfigType<typeof storageConfig>,
  endpoint: string,
): S3Client {
  return new S3Client({
    endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    // MinIO and third-party presigned uploads do not send flexible checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (cfg: ConfigType<typeof storageConfig>) =>
        createS3Client(cfg, cfg.endpoint),
    },
    {
      provide: S3_PRESIGN_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (cfg: ConfigType<typeof storageConfig>) =>
        createS3Client(cfg, cfg.publicEndpoint),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
