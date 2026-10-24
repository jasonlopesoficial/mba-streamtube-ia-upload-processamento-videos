import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should apply the configured key prefix to registered queues', async () => {
    process.env.QUEUE_PREFIX = 'queue-module-spec';
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        BullModule.registerQueue({ name: 'queue-module-spec' }),
      ],
    }).compile();

    const queue = module.get<Queue>(getQueueToken('queue-module-spec'));
    expect(queue.opts.prefix).toBe('queue-module-spec');

    await queue.close();
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });
});
