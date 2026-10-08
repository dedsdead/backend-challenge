import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { v4 } from 'uuid';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/database/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../src/database/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
import { MikroOrmOutboxMessageRepository } from '../../src/database/repositories';
import { WalletsService } from '../../src/modules/wallets/wallets.service';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/enums';
import { WalletBalanceChanged } from '../../src/events/wallet-balance-changed.event';
import { WagerTransactionProcessed } from '../../src/events/wager-transaction-processed.event';
import { WagerTransactionRejected } from '../../src/events/wager-transaction-rejected.event';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

const truncate = async (view: EntityManager) => {
  await view.getConnection().execute('TRUNCATE TABLE outbox_message');
  await view.nativeDelete(WalletEntity, {} as never);
  await view.nativeDelete(OutboxMessageEntity, {} as never);
};

describe('OutboxPublisherWorker (T038)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let wallets: any;

  beforeAll(async () => {
    await acquireTestLock();
    orm = await MikroORM.init({
      entities: [
        WalletEntity,
        WagerTransactionEntity,
        WalletLedgerEntryEntity,
        OutboxMessageEntity,
      ],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: PostgreSqlDriver,
    });
    em = orm.em.fork();
    await truncate(em);
  }, 15_000);

  afterAll(async () => {
    await truncate(orm.em.fork());
    await orm.close();
  }, 15_000);

  const newWallet = async (amount = '1000.00') => {
    const playerId = v4();
    const wallet = await wallets.create({
      playerId,
      initialBalance: { amount, currency: 'BRL' },
    });
    return { id: wallet.id, playerId };
  };

  it('should publish pending outbox messages and mark them as published', async () => {
    // Create outbox messages (pending)
    await em.transactional(async (tx) => {
      await tx.persist(
        tx.create(OutboxMessageEntity, {
          id: v4(),
          aggregateId: v4(),
          eventType: 'WalletBalanceChanged',
          payload: { walletId: 'test', transactionId: 'test', direction: 'CREDIT', money: { amount: '100.00', currency: 'BRL' }, balanceBefore: { amount: '0.00', currency: 'BRL' }, balanceAfter: { amount: '100.00', currency: 'BRL' }, walletVersion: 1 },
          occurredAt: new Date(),
          attempts: 0,
        } as any)
      );
      await tx.persist(
        tx.create(OutboxMessageEntity, {
          id: v4(),
          aggregateId: v4(),
          eventType: 'WagerTransactionProcessed',
          payload: { transactionId: v4(), walletId: v4(), kind: 'BET', money: { amount: '100.00', currency: 'BRL' }, balanceBefore: { amount: '1000.00', currency: 'BRL' }, balanceAfter: { amount: '900.00', currency: 'BRL' }, walletVersion: 1 },
          occurredAt: new Date(),
          attempts: 0,
        } as any)
      );
    });

    // Call the worker's processBatch to process the messages
    const { OutboxPublisherWorker } = await import('../../src/workers/outbox-publisher.worker');
    
    // Create mock config
    const mockConfig = {
      get: (key: string) => {
        if (key === 'SQS_ENDPOINT') return 'http://localhost:4566';
        if (key === 'SQS_QUEUE_URL') return 'http://localhost:4566/000000000000/wager-transactions.fifo';
        if (key === 'WORKERS_ENABLED') return false;
        return undefined;
      },
      getOrThrow: (key: string) => {
        if (key === 'SQS_ENDPOINT') return 'http://localhost:4566';
        if (key === 'SQS_QUEUE_URL') return 'http://localhost:4566/000000000000/wager-transactions.fifo';
        if (key === 'WORKERS_ENABLED') return false;
        throw new Error(`Missing config: ${key}`);
      },
    } as any;

    const worker = new OutboxPublisherWorker(mockConfig, em);
    
    // Call processBatch to process the messages
    await worker.processBatch();
    
// Verify messages were published and marked as published
      const publishedMessages = await em.find(OutboxMessageEntity, {});
      
      // Check that messages were marked as published
      for (const msg of publishedMessages) {
        expect(msg.publishedAt).toBeDefined();
        expect(msg.publishedAt).not.toBeNull();
      }
      
      expect(publishedMessages.length).toBe(2);
  });
});