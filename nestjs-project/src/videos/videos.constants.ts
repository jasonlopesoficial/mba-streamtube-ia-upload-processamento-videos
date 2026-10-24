export const VideoStatus = {
  DRAFT: 'draft',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];

export const VIDEO_SLUG_LENGTH = 11;

export const SLUG_COLUMN = 'slug';
export const MAX_SLUG_ATTEMPTS = 5;
