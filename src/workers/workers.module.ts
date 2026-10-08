import { Module } from '@nestjs/common';
import { OutboxPublisherWorker } from './outbox-publisher.worker';
import { PendingReferenceWorker } from './pending-reference.worker';

/**
 * Workers Module
 *
 * Registers and manages background workers for outbox publishing and pending reference resolution.
 * Workers are started when WORKERS_ENABLED=true (via onModuleInit in each worker).
 */
@Module({
  providers: [
    OutboxPublisherWorker,
    PendingReferenceWorker,
  ],
  exports: [
    OutboxPublisherWorker,
    PendingReferenceWorker,
  ],
})
export class WorkersModule {}