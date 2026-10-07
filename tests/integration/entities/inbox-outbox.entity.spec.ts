import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { InboxMessageEntity } from '../../../src/database/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../../src/database/entities/outbox-message.entity';

describe('InboxMessageEntity', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    const { InboxMessageEntity } = await import('../../../src/database/entities/inbox-message.entity');
    const { OutboxMessageEntity } = await import('../../../src/database/entities/outbox-message.entity');

    const ormInstance = await MikroORM.init({
      entities: [InboxMessageEntity, OutboxMessageEntity],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
    });
    orm = ormInstance;
    em = orm.em.fork();
    // Schema is owned by migration 001; clean rows so runs are idempotent.
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('should create inbox message', async () => {
    const msg = em.create(InboxMessageEntity, {
      messageId: v4(),
      consumerName: 'consumer-1',
      payloadHash: 'hash123',
      receivedAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;

    await em.persist(msg).flush();

    expect(msg.id).toBeDefined();
    expect(msg.consumerName).toBe('consumer-1');
    expect(msg.payloadHash).toBe('hash123');
    expect(msg.receivedAt).toEqual(new Date('2024-01-01T10:00:00Z'));
    expect(msg.processedAt).toBeUndefined();
  });

  it('should enforce unique constraint on messageId + consumerName', async () => {
    const messageId = v4();
    const msg1 = em.create(InboxMessageEntity, {
      messageId: messageId,
      consumerName: 'consumer-1',
      payloadHash: 'hash123',
      receivedAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;
    await em.persist(msg1).flush();

    // Same messageId and consumerName but different payloadHash should fail
    const msg2 = em.create(InboxMessageEntity, {
      messageId: messageId,
      consumerName: 'consumer-1',
      payloadHash: 'different-hash',
      receivedAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;
    em.persist(msg2);

    await expect(em.flush()).rejects.toThrow();
  });

  it('should mark as processed', async () => {
    const msg = em.create(InboxMessageEntity, {
      messageId: v4(),
      consumerName: 'consumer-2',
      payloadHash: 'hash123',
      receivedAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;
    await em.persist(msg).flush();
    msg.processedAt = new Date('2024-01-01T10:01:00Z');
    await em.flush();

    expect(msg.processedAt).toEqual(new Date('2024-01-01T10:01:00Z'));
  });
});

describe('OutboxMessageEntity', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    const { OutboxMessageEntity } = await import('../../../src/database/entities/outbox-message.entity');
    const { InboxMessageEntity } = await import('../../../src/database/entities/inbox-message.entity');

    const ormInstance = await MikroORM.init({
      entities: [InboxMessageEntity, OutboxMessageEntity],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
    });
    orm = ormInstance;
    em = orm.em.fork();
    // Schema is owned by migration 001; clean rows so runs are idempotent.
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('should create outbox message', async () => {
    const eventId = v4();
    const msg = em.create(OutboxMessageEntity, {
      id: eventId,
      aggregateId: v4(),
      eventType: 'TestEvent',
      payload: { test: 'data' },
      occurredAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;

    await em.persist(msg).flush();

    expect(msg.id).toBe(eventId);
    expect(msg.aggregateId).toBeDefined();
    expect(msg.eventType).toBe('TestEvent');
    expect(msg.payload).toEqual({ test: 'data' });
    expect(msg.occurredAt).toEqual(new Date('2024-01-01T10:00:00Z'));
    expect(msg.attempts).toBe(0);
    expect(msg.nextAttemptAt).toBeUndefined();
    expect(msg.publishedAt).toBeUndefined();
  });

  it('should mark as published', async () => {
    const eventId = v4();
    const msg = em.create(OutboxMessageEntity, {
      id: eventId,
      aggregateId: v4(),
      eventType: 'TestEvent',
      payload: { test: 'data' },
      occurredAt: new Date('2024-01-01T10:00:00Z'),
    } as never) as any;
    await em.persist(msg).flush();
    msg.publishedAt = new Date('2024-01-01T10:01:00Z');
    await em.flush();

    expect(msg.publishedAt).toEqual(new Date('2024-01-01T10:01:00Z'));
  });

});
