import type { VideoMetadata } from '../videos/entities/video.entity';
import { MediaProbeError } from './media-probe.errors';

export interface ProbeResult {
  durationSeconds: number;
  metadata: VideoMetadata;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string; bit_rate?: string };
  streams?: FfprobeStream[];
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Maps `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbeOutput(raw: string): ProbeResult {
  let output: FfprobeOutput;
  try {
    output = JSON.parse(raw) as FfprobeOutput;
  } catch {
    throw new MediaProbeError('ffprobe returned invalid JSON');
  }

  const streams = output.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) {
    throw new MediaProbeError('No video stream found');
  }
  const audio = streams.find((s) => s.codec_type === 'audio');

  const duration =
    toNumber(output.format?.duration) ?? toNumber(video.duration);
  if (duration === null || duration <= 0) {
    throw new MediaProbeError('Could not determine the video duration');
  }

  return {
    durationSeconds: duration,
    metadata: {
      format_name: output.format?.format_name ?? 'unknown',
      bit_rate: toNumber(output.format?.bit_rate),
      width: video.width ?? null,
      height: video.height ?? null,
      video_codec: video.codec_name ?? null,
      audio_codec: audio?.codec_name ?? null,
    },
  };
}
