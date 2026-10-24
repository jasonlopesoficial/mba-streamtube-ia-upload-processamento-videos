/** The input could not be read as a video (corrupt, unsupported or timed out). */
export class MediaProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaProbeError';
  }
}
