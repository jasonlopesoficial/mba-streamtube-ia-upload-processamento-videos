export const S3_CLIENT = Symbol('S3_CLIENT');
export const S3_PRESIGN_CLIENT = Symbol('S3_PRESIGN_CLIENT');

export const STORAGE_KEY_PREFIXES = {
  VIDEOS: 'videos',
  THUMBNAILS: 'thumbnails',
} as const;

export const S3_UPLOAD_REJECTION_CODES = [
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
  'NoSuchUpload',
] as const;

export function videoSourceKey(videoId: string): string {
  return `${STORAGE_KEY_PREFIXES.VIDEOS}/${videoId}/source`;
}

export function thumbnailKey(videoId: string): string {
  return `${STORAGE_KEY_PREFIXES.THUMBNAILS}/${videoId}.jpg`;
}
