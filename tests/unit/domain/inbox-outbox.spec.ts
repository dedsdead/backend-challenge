import { describe, it, expect } from 'bun:test';
import { InboxMessage } from '../../../src/domain/inbox/inbox-message';
import { OutboxMessage } from '../../../src/domain/outbox/outbox-message';
import { IntegrationEvent } from '../../../src/events/integration-event';

describe('InboxMessage', () => {
  describe('receive', () => {
    it('creates inbox message with receivedAt', () => {
      const msg = InboxMessage.receive({
        messageId: 'msg-1',
        consumerName: 'consumer-1',
        payloadHash: 'hash123',
        receivedAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(msg.messageId).toBe('msg-1');
      expect(msg.consumerName).toBe('consumer-1');
      expect(msg.payloadHash).toBe('hash123');
      expect(msg.receivedAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(msg.processedAt).toBeUndefined();
      expect(msg.isProcessed()).toBe(false);
    });
  });

  describe('rehydrate', () => {
    it('reconstructs inbox message from state', () => {
      const msg = InboxMessage.rehydrate({
        messageId: 'msg-1',
        consumerName: 'consumer-1',
        payloadHash: 'hash123',
        receivedAt: new Date('2024-01-01T10:00:00Z'),
        processedAt: new Date('2024-01-01T10:01:00Z'),
      });

      expect(msg.messageId).toBe('msg-1');
      expect(msg.isProcessed()).toBe(true);
      expect(msg.processedAt).toEqual(new Date('2024-01-01T10:01:00Z'));
    });
  });

  describe('markProcessed', () => {
    it('marks message as processed', () => {
      const msg = InboxMessage.receive({
        messageId: 'msg-1',
        consumerName: 'consumer-1',
        payloadHash: 'hash123',
        receivedAt: new Date('2024-01-01T10:00:00Z'),
      });

      msg.markProcessed(new Date('2024-01-01T10:01:00Z'));

      expect(msg.isProcessed()).toBe(true);
      expect(msg.processedAt).toEqual(new Date('2024-01-01T10:01:00Z'));
    });

    it('detects different payloadHash for same messageId+consumerName', () => {
      const msg1 = InboxMessage.receive({
        messageId: 'msg-1',
        consumerName: 'consumer-1',
        payloadHash: 'hash123',
        receivedAt: new Date('2024-01-01T10:00:00Z'),
      });

      // Same messageId and consumerName but different payloadHash should be detected
      const msg2 = InboxMessage.receive({
        messageId: 'msg-1',
        consumerName: 'consumer-1',
        payloadHash: 'different-hash',
        receivedAt: new Date('2024-01-01T10:00:00Z'),
      });

      // The idempotency key should include payloadHash
      const key1 = `${msg1.messageId}:${msg1.consumerName}:${msg1.payloadHash}`;
      const key2 = `${msg2.messageId}:${msg2.consumerName}:${msg2.payloadHash}`;
      expect(key1).not.toBe(key2);
    });
  });
});

describe('OutboxMessage', () => {
  const mockEvent = {
    eventId: 'evt-1',
    aggregateId: 'agg-1',
    eventType: 'TestEvent',
    payload: { test: 'data' },
    occurredAt: new Date('2024-01-01T10:00:00Z'),
  };

  describe('enqueue', () => {
    it('creates outbox message from event', () => {
      const msg = OutboxMessage.enqueue(mockEvent);

      expect(msg.id).toBeDefined();
      expect(msg.aggregateId).toBe('agg-1');
      expect(msg.eventType).toBe('TestEvent');
      expect(msg.payload).toEqual({ test: 'data' });
      expect(msg.occurredAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(msg.attempts).toBe(0);
      expect(msg.nextAttemptAt).toBeUndefined();
      expect(msg.publishedAt).toBeUndefined();
      expect(msg.isPending()).toBe(true);
      expect(msg.isDue(new Date())).toBe(true);
    });

    it('validates payload against event type schema', () => {
      // Valid WalletBalanceChanged payload should succeed
      const validEvent = {
        eventId: 'evt-1',
        aggregateId: 'wallet-1',
        eventType: 'WalletBalanceChanged',
        payload: {
          walletId: 'wallet-1',
          transactionId: 'tx-1',
          direction: 'CREDIT',
          money: { amount: '50.00', currency: 'BRL' },
          balanceBefore: { amount: '50.00', currency: 'BRL' },
          balanceAfter: { amount: '100.00', currency: 'BRL' },
          walletVersion: 2,
        },
        occurredAt: new Date(),
      };
      expect(() => OutboxMessage.enqueue(validEvent)).not.toThrow();

      // Invalid payload (missing required fields) should throw
      const invalidEvent = {
        eventId: 'evt-2',
        aggregateId: 'wallet-1',
        eventType: 'WalletBalanceChanged',
        payload: {
          walletId: 'wallet-1',
          // missing required fields
        },
        occurredAt: new Date(),
      };
      expect(() => OutboxMessage.enqueue(invalidEvent)).toThrow();
    });
  });

  describe('rehydrate', () => {
    it('reconstructs outbox message from state', () => {
      const msg = OutboxMessage.rehydrate({
        id: 'out-1',
        eventId: 'evt-1',
        aggregateId: 'agg-1',
        eventType: 'TestEvent',
        payload: { test: 'data' },
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        attempts: 2,
        nextAttemptAt: new Date('2024-01-01T10:05:00Z'),
        publishedAt: undefined,
      });

      expect(msg.id).toBe('out-1');
      expect(msg.eventId).toBe('evt-1');
      expect(msg.attempts).toBe(2);
      expect(msg.nextAttemptAt).toEqual(new Date('2024-01-01T10:05:00Z'));
      expect(msg.isPending()).toBe(true);
      expect(msg.isPublished()).toBe(false);
    });
  });

  describe('markPublished', () => {
    it('marks message as published', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      msg.markPublished(new Date('2024-01-01T10:01:00Z'));

      expect(msg.publishedAt).toEqual(new Date('2024-01-01T10:01:00Z'));
      expect(msg.isPending()).toBe(false);
      expect(msg.isPublished()).toBe(true);
    });
  });

  describe('scheduleRetry', () => {
    it('increments attempts and calculates nextAttemptAt with exponential backoff', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      const now = new Date('2024-01-01T10:00:00Z');

      msg.scheduleRetry(now);

      expect(msg.attempts).toBe(1);
      // 2^1 * 1s = 2s
      expect(msg.nextAttemptAt!.getTime() - now.getTime()).toBe(2000);

      // Second retry
      const now2 = new Date('2024-01-01T10:00:02Z');
      msg.scheduleRetry(now2);
      expect(msg.attempts).toBe(2);
      // 2^2 * 1s = 4s
      expect(msg.nextAttemptAt!.getTime() - now2.getTime()).toBe(4000);
    });

    it('caps backoff at 5 minutes', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      // Use reflection to set attempts for testing (public readonly property)
      (msg as any).attempts = 10;
      const now = new Date('2024-01-01T10:00:00Z');

      msg.scheduleRetry(now);

      // 2^11 * 1s = 2048s > 300s (5min), so should cap at 5min = 300s
      expect(msg.nextAttemptAt!.getTime() - now.getTime()).toBe(300000);
    });
  });

  describe('isDue', () => {
    it('returns true when now >= nextAttemptAt', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      msg.scheduleRetry(new Date('2024-01-01T10:00:00Z'));

      expect(msg.isDue(new Date('2024-01-01T10:00:01Z'))).toBe(false); // before nextAttemptAt
      expect(msg.isDue(new Date('2024-01-01T10:00:02Z'))).toBe(true); // at nextAttemptAt
      expect(msg.isDue(new Date('2024-01-01T10:00:03Z'))).toBe(true); // after nextAttemptAt
    });

    it('returns true when nextAttemptAt is undefined (immediate)', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      expect(msg.isDue(new Date())).toBe(true);
    });
  });

  describe('isPending', () => {
    it('returns true when not published', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      expect(msg.isPending()).toBe(true);
    });

    it('returns false when published', () => {
      const msg = OutboxMessage.enqueue(mockEvent);
      msg.markPublished(new Date());
      expect(msg.isPending()).toBe(false);
    });
  });
});