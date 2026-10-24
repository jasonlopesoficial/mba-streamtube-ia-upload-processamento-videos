import { MediaProbeError } from './media-probe.errors';
import { parseProbeOutput } from './media-probe.parser';

const validOutput = {
  format: {
    duration: '3.000000',
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    bit_rate: '123456',
  },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 320, height: 240 },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
};

describe('parseProbeOutput', () => {
  it('extracts duration and metadata from a valid probe', () => {
    expect(parseProbeOutput(JSON.stringify(validOutput))).toEqual({
      durationSeconds: 3,
      metadata: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        bit_rate: 123456,
        width: 320,
        height: 240,
        video_codec: 'h264',
        audio_codec: 'aac',
      },
    });
  });

  it('falls back to the video stream duration and tolerates missing audio', () => {
    const result = parseProbeOutput(
      JSON.stringify({
        format: { format_name: 'webm' },
        streams: [{ codec_type: 'video', codec_name: 'vp9', duration: '7.5' }],
      }),
    );

    expect(result.durationSeconds).toBe(7.5);
    expect(result.metadata).toMatchObject({
      audio_codec: null,
      bit_rate: null,
    });
  });

  it('rejects output without a video stream', () => {
    expect(() =>
      parseProbeOutput(
        JSON.stringify({ ...validOutput, streams: [{ codec_type: 'audio' }] }),
      ),
    ).toThrow(MediaProbeError);
  });

  it('rejects output without a usable duration', () => {
    expect(() =>
      parseProbeOutput(
        JSON.stringify({ ...validOutput, format: { format_name: 'mp4' } }),
      ),
    ).toThrow(MediaProbeError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseProbeOutput('not json')).toThrow(MediaProbeError);
  });
});
