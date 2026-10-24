import type { Readable } from 'node:stream';

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface StoredPart extends CompletedPart {
  sizeBytes: number;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
}

export interface ObjectStream {
  body: Readable;
  contentLength: number;
  contentRange: string | undefined;
}
