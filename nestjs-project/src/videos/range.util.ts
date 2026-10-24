export interface ByteRange {
  start: number;
  end: number;
}

export const UNSATISFIABLE = 'unsatisfiable' as const;

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a single `Range: bytes=` header (RFC 9110 §14.1.2).
 * Returns `null` when the header is absent, multi-range or malformed (callers
 * serve the full body) and `'unsatisfiable'` when it starts beyond the end.
 */
export function parseRangeHeader(
  header: string | undefined,
  sizeBytes: number,
): ByteRange | typeof UNSATISFIABLE | null {
  if (!header) return null;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return UNSATISFIABLE;
    return { start: Math.max(sizeBytes - suffix, 0), end: sizeBytes - 1 };
  }

  const start = Number(rawStart);
  if (start >= sizeBytes) return UNSATISFIABLE;
  const end = rawEnd === '' ? sizeBytes - 1 : Number(rawEnd);
  if (end < start) return null;
  return { start, end: Math.min(end, sizeBytes - 1) };
}
