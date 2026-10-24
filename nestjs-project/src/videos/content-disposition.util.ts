const UNSAFE_ASCII = /["\\/\r\n\x00-\x1f\x7f]/g; // eslint-disable-line no-control-regex
const NON_ASCII = /[^\x20-\x7e]/g;

/**
 * `attachment` Content-Disposition with an ASCII fallback plus the RFC 5987
 * `filename*` form so non-ASCII names survive.
 */
export function buildAttachmentDisposition(filename: string): string {
  const fallback =
    filename.replace(UNSAFE_ASCII, '').replace(NON_ASCII, '_').trim() ||
    'video';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
