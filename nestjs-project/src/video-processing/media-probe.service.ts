import { spawn } from 'node:child_process';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videosConfig from '../config/videos.config';
import { MediaProbeError } from './media-probe.errors';
import { parseProbeOutput, type ProbeResult } from './media-probe.parser';

const THUMBNAIL_WIDTH = 1280;
const STDERR_LIMIT = 2000;

/** Runs the system `ffprobe` / `ffmpeg` binaries against a file path or URL. */
@Injectable()
export class MediaProbeService {
  constructor(
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  async probe(input: string): Promise<ProbeResult> {
    const stdout = await this.run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ]);
    return parseProbeOutput(stdout.toString('utf8'));
  }

  /** Captures one JPEG frame at `atSeconds` (input seeking — only needed bytes are read). */
  async captureFrame(input: string, atSeconds: number): Promise<Buffer> {
    const frame = await this.run('ffmpeg', [
      '-v',
      'error',
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      `scale=${THUMBNAIL_WIDTH}:-2`,
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ]);
    if (frame.length === 0) {
      throw new MediaProbeError('ffmpeg produced no frame');
    }
    return frame;
  }

  private run(command: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.config.probeTimeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new MediaProbeError(
              `${command} timed out after ${this.config.probeTimeoutMs} ms`,
            ),
          );
        } else if (code !== 0) {
          reject(
            new MediaProbeError(
              `${command} exited with code ${code}: ${stderr.trim().slice(0, STDERR_LIMIT)}`,
            ),
          );
        } else {
          resolve(Buffer.concat(stdout));
        }
      });
    });
  }
}
