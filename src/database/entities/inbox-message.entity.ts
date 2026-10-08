import { defineEntity } from '@mikro-orm/core';

export const InboxMessageEntity = defineEntity({
  name: 'InboxMessageEntity',
  tableName: 'inbox_message',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    messageId: { type: 'string' },
    consumerName: { type: 'string' },
    payloadHash: { type: 'string' },
    receivedAt: { type: 'datetime', onCreate: () => new Date() },
    processedAt: { type: 'datetime', nullable: true },
  },
  indexes: [
    { properties: ['consumerName', 'messageId'], name: 'idx_inbox_consumer_message' },
  ],
  uniques: [
    { properties: ['consumerName', 'messageId'], name: 'uq_inbox_consumer_message' },
  ],
});

export type InboxMessageEntityType = typeof InboxMessageEntity;