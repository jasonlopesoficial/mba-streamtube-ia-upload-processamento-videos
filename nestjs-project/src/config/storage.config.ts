import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => {
  const endpoint = process.env.S3_ENDPOINT || 'http://minio:9000';
  return {
    endpoint,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET || 'streamtube',
    presignExpirationSeconds: parseInt(
      process.env.S3_PRESIGN_EXPIRATION_SECONDS || '3600',
      10,
    ),
  };
});
