import { randomBytes } from 'node:crypto';
import { VIDEO_SLUG_LENGTH } from './videos.constants';

/** 11-char base64url slug (~64 bits of randomness), YouTube-style. */
export function generateVideoSlug(): string {
  return randomBytes(8).toString('base64url').slice(0, VIDEO_SLUG_LENGTH);
}
