import { buildAttachmentDisposition } from './content-disposition.util';

describe('buildAttachmentDisposition', () => {
  it('keeps plain ASCII names', () => {
    expect(buildAttachmentDisposition('movie.mp4')).toBe(
      `attachment; filename="movie.mp4"; filename*=UTF-8''movie.mp4`,
    );
  });

  it('encodes accents and spaces in filename* with an ASCII fallback', () => {
    expect(buildAttachmentDisposition('meu vídeo.mp4')).toBe(
      `attachment; filename="meu v_deo.mp4"; filename*=UTF-8''meu%20v%C3%ADdeo.mp4`,
    );
  });

  it('neutralizes quotes, slashes and control characters', () => {
    const header = buildAttachmentDisposition('a"b\\c/d\r\ne.mp4');

    expect(header).toContain('filename="abcde.mp4"');
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('falls back to a generic name when nothing printable remains', () => {
    expect(buildAttachmentDisposition('""')).toContain('filename="video"');
  });
});
