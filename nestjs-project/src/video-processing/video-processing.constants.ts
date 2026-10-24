export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

/** Payload of the `process-video` job (see plan § Events/Messages). */
export interface VideoProcessingJobData {
  videoId: string;
}
