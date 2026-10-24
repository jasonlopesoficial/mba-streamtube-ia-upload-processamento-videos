import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';

/**
 * Points BullMQ at an isolated key prefix so jobs created by tests are never
 * consumed by the Compose `video-worker`. Call before compiling the module.
 */
export function useIsolatedQueuePrefix(): string {
  const prefix = `test-${randomUUID().slice(0, 8)}`;
  process.env.QUEUE_PREFIX = prefix;
  return prefix;
}

export async function obliterateQueue(queue: Queue): Promise<void> {
  await queue.obliterate({ force: true });
}
