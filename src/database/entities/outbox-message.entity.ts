import { defineEntity } from '@mikro-orm/core';

export const OutboxMessageEntity = defineEntity({
  name: 'OutboxMessageEntity',
  tableName: 'outbox_message',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    eventId: { type: 'uuid' },
    aggregateId: { type: 'uuid' },
    eventType: { type: 'string' },
    payload: { type: 'jsonb' },
    occurredAt: { type: 'datetime', onCreate: () => new Date() },
    attempts: { type: 'int', default: 0 },
    nextAttemptAt: { type: 'timestamptz', nullable: true },
    publishedAt: { type: 'datetime', nullable: true },
  },
  indexes: [
    { properties: ['publishedAt', 'nextAttemptAt'], name: 'idx_outbox_published_next_attempt' },
  ],
});

export type OutboxMessageEntityType = typeof OutboxMessageEntity;