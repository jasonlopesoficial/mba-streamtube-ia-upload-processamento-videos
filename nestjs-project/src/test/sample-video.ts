import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface SampleVideo {
  path: string;
  bytes: Buffer;
  cleanup: () => Promise<void>;
}

/** Generates a small H.264/AAC MP4 (`testsrc` + `sine`) for media tests. */
export async function createSampleVideo(
  durationSeconds = 3,
): Promise<SampleVideo> {
  const dir = await mkdtemp(join(tmpdir(), 'streamtube-sample-'));
  const path = join(dir, 'sample.mp4');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${durationSeconds}:size=320x240:rate=25`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${durationSeconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    path,
  ]);
  return {
    path,
    bytes: await readFile(path),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
