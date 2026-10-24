import type { Readable } from 'node:stream';

/** A storage-backed HTTP body plus the status/headers to send with it. */
export interface VideoDelivery {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}
