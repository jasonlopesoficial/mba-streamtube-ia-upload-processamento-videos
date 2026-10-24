export const VideoStatus = {
  DRAFT: 'draft',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];

export const VIDEO_SLUG_LENGTH = 11;
