// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { v4 } from 'uuid';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/database/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
import { OutboxPublisherWorker } from '../../src/workers/outbox-publisher.worker';
import { PendingReferenceWorker } from '../../src/workers/pending-reference.worker';
import { ConfigService } from '@nestjs/config';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from '../../src/domain/enums';

const truncate = async (view: EntityManager) => {
  await view.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
  await view.getConnection().execute('TRUNCATE TABLE outbox_message');
  await view.nativeDelete(WagerTransactionEntity, {} as never);
  await view.nativeDelete(WalletEntity, {} as never);
};

describe('Workers Integration (T042)', () => {
  let orm: MikroORM;
  let em: EntityManager;

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
  }, 30_000);

  afterAll(async () => {
    await truncate(orm.em.fork());
    await orm.close();
  }, 30_000);

  const mockConfig = {
    get: (key: string) => {
      if (key === 'WORKERS_ENABLED') return false;
      if (key === 'SQS_ENDPOINT') return 'http://localhost:4566';
      if (key === 'SQS_QUEUE_URL') return 'http://localhost:4566/000000000000/wager-transactions.fifo';
      return undefined;
    },
    getOrThrow: (key: string) => {
      if (key === 'WORKERS_ENABLED') return false;
      if (key === 'SQS_ENDPOINT') return 'http://localhost:4566';
      if (key === 'SQS_QUEUE_URL') return 'http://localhost:4566/000000000000/wager-transactions.fifo';
      throw new Error(`Missing config: ${key}`);
    },
  } as any;

  const createWallet = async (em: EntityManager, balance = '1000.00') => {
    const walletId = v4();
    const playerId = v4();
    await em.persist(
      em.create(WalletEntity, {
        id: walletId,
        playerId,
        currency: 'BRL',
        balanceAmount: balance,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
    );
    await em.flush();
    return { id: walletId, playerId };
  };

  const createProcessedBet = async (em: EntityManager, walletId: string, playerId: string, externalId: string, roundId: string) => {
    const txId = v4();
    await em.persist(
      em.create(WagerTransactionEntity, {
        id: txId,
        providerId: 'provider-1',
        externalTransactionId: externalId,
        idempotencyKey: `idem-${externalId}`,
        payloadHash: 'hash123',
        walletId,
        playerId,
        roundId,
        gameId: v4(),
        kind: 'BET',
        moneyAmount: '100.00',
        moneyCurrency: 'BRL',
        referenceExternalTransactionId: null,
        status: 'PROCESSED',
        referenceTransactionId: null,
        failureCode: null,
        processedAt: new Date(),
        resultBalanceAmount: '900.00',
        resultBalanceCurrency: 'BRL',
        referenceAttempts: 0,
        referenceNextAttemptAt: null,
        createdAt: new Date(),
      } as any)
    );
    // Also update wallet balance to reflect the BET (1000 - 100 = 900)
    await em.nativeUpdate(WalletEntity, { id: walletId }, { balanceAmount: '900.00', version: 2 });
    await em.flush();
    return txId;
  };

  const createPendingRollback = async (em: EntityManager, walletId: string, playerId: string, externalId: string, roundId: string, referenceExternalId: string) => {
    const txId = v4();
    await em.persist(
      em.create(WagerTransactionEntity, {
        id: txId,
        providerId: 'provider-1',
        externalTransactionId: externalId,
        idempotencyKey: `idem-${externalId}`,
        payloadHash: 'hash123',
        walletId,
        playerId,
        roundId,
        gameId: v4(),
        kind: 'ROLLBACK',
        moneyAmount: '100.00',
        moneyCurrency: 'BRL',
        referenceExternalTransactionId: referenceExternalId,
        status: 'PENDING_REFERENCE',
        referenceTransactionId: null,
        failureCode: null,
        processedAt: null,
        resultBalanceAmount: '900.00',
        resultBalanceCurrency: 'BRL',
        referenceAttempts: 0,
        referenceNextAttemptAt: null,
        createdAt: new Date(),
      } as any)
    );
    await em.flush();
    return txId;
  };

  const createPendingRefund = async (em: EntityManager, walletId: string, playerId: string, externalId: string, roundId: string, referenceExternalId: string) => {
    const txId = v4();
    await em.persist(
      em.create(WagerTransactionEntity, {
        id: txId,
        providerId: 'provider-1',
        externalTransactionId: externalId,
        idempotencyKey: `idem-${externalId}`,
        payloadHash: 'hash123',
        walletId,
        playerId,
        roundId,
        gameId: v4(),
        kind: 'REFUND',
        moneyAmount: '100.00',
        moneyCurrency: 'BRL',
        referenceExternalTransactionId: referenceExternalId,
        status: 'PENDING_REFERENCE',
        referenceTransactionId: null,
        failureCode: null,
        processedAt: null,
        resultBalanceAmount: '900.00',
        resultBalanceCurrency: 'BRL',
        referenceAttempts: 0,
        referenceNextAttemptAt: null,
        createdAt: new Date(),
      } as any)
    );
    await em.flush();
    return txId;
  };

  describe('AC-9: Out-of-order ROLLBACK → BET resolution', () => {
    it('should resolve pending ROLLBACK when reference BET arrives and is processed by worker', async () => {
      const { id: walletId, playerId } = await createWallet(em, '1000.00');
      const roundId = v4();

      // First, create a pending ROLLBACK (out-of-order - no BET exists yet)
      const rollbackTxId = await createPendingRollback(em, walletId, playerId, 'rollback-1', roundId, 'bet-external-1');

      // Run worker - should schedule retry since BET not found
      const pendingWorker = new PendingReferenceWorker(mockConfig, em);
      await pendingWorker.processBatch();

      // Verify still pending - use fresh EM to see DB changes
      let freshEm1 = orm.em.fork();
      let tx = await freshEm1.findOne(WagerTransactionEntity, { id: rollbackTxId }) as any;
      expect(tx?.status).toBe('PENDING_REFERENCE');
      expect(tx?.referenceAttempts).toBe(1);

      // Now create the reference BET
      await createProcessedBet(em, walletId, playerId, 'bet-external-1', roundId);

      // Reset referenceNextAttemptAt to now so worker picks it up again
      await em.nativeUpdate(WagerTransactionEntity, { id: rollbackTxId }, {
        referenceNextAttemptAt: new Date(Date.now() - 1000),
      });

      // Run worker again - should now resolve
      await pendingWorker.processBatch();

      // Verify ROLLBACK resolved to PROCESSED
      const freshEm = orm.em.fork();
      tx = await freshEm.findOne(WagerTransactionEntity, { id: rollbackTxId }) as any;
      expect(tx?.status).toBe('PROCESSED');
      expect(tx?.referenceTransactionId).toBeDefined();

      // Verify ledger entry created (CREDIT for ROLLBACK of BET = inverse of BET's DEBIT)
      const ledgerEntries = await freshEm.find(WalletLedgerEntryEntity, { transactionId: rollbackTxId }) as any[];
      expect(ledgerEntries.length).toBe(1);
      expect(ledgerEntries[0]?.direction).toBe('CREDIT');
      expect(ledgerEntries[0]?.moneyAmount).toBe('100.00');

      // Verify wallet balance restored (900 + 100 = 1000)
      const wallet = await freshEm.findOne(WalletEntity, { id: walletId }) as any;
      expect(wallet?.balanceAmount).toBe('1000.00');
    });
  });

  describe('AC-10: Never-arriving reference exhausts retries', () => {
    it('should reject after 10 attempts with REFERENCE_NOT_FOUND and emit WagerTransactionRejected to outbox', async () => {
      const { id: walletId, playerId } = await createWallet(em, '1000.00');
      const roundId = v4();

      // Create pending REFUND with non-existent reference
      const refundTxId = await createPendingRefund(em, walletId, playerId, 'refund-1', roundId, 'non-existent-bet');

      // Update to attempt 10 with past due date
      await em.nativeUpdate(WagerTransactionEntity, { id: refundTxId }, {
        referenceAttempts: 10,
        referenceNextAttemptAt: new Date(Date.now() - 1000),
      });

      const pendingWorker = new PendingReferenceWorker(mockConfig, em);
      await pendingWorker.processBatch();

      // Verify rejected
      const freshEm = orm.em.fork();
      const tx = await freshEm.findOne(WagerTransactionEntity, { id: refundTxId }) as any;
      expect(tx?.status).toBe('REJECTED');
      expect(tx?.failureCode).toBe('REFERENCE_NOT_FOUND');

      // Verify no ledger entry
      const ledgerEntries = await freshEm.find(WalletLedgerEntryEntity, { transactionId: refundTxId }) as any[];
      expect(ledgerEntries.length).toBe(0);

      // Verify wallet balance unchanged
      const wallet = await freshEm.findOne(WalletEntity, { id: walletId }) as any;
      expect(wallet?.balanceAmount).toBe('1000.00');

      // Verify WagerTransactionRejected event in outbox
      const outboxMessages = await freshEm.find(OutboxMessageEntity, {}) as any[];
      const rejectedEvent = outboxMessages.find((m: any) => m.eventType === 'WagerTransactionRejected');
      expect(rejectedEvent).toBeDefined();
      expect(rejectedEvent?.payload?.failureCode).toBe('REFERENCE_NOT_FOUND');
      expect(rejectedEvent?.publishedAt).toBeNull(); // not yet published
    });
  });

  describe('AC-15: Crash-after-commit at-least-once publishing', () => {
    it('should publish pending outbox messages after app restart (simulated by new worker instance)', async () => {
      // Create wallet and transaction
      const { id: walletId, playerId } = await createWallet(em, '1000.00');
      const roundId = v4();
      await createProcessedBet(em, walletId, playerId, 'bet-1', roundId);

      // Create pending outbox message (simulating crash after commit but before publish)
      const outboxMsgId = v4();
      await em.persist(
        em.create(OutboxMessageEntity, {
          id: outboxMsgId,
          aggregateId: v4(),
          eventType: 'WagerTransactionProcessed',
          payload: { transactionId: 'test', walletId, kind: 'BET', money: { amount: '100.00', currency: 'BRL' } },
          occurredAt: new Date(),
          attempts: 0,
          nextAttemptAt: null,
          publishedAt: null,
        } as any)
      );
      await em.flush();

      // Verify initially not published
      let outboxMsg = await em.findOne(OutboxMessageEntity, { id: outboxMsgId }) as any;
      expect(outboxMsg?.publishedAt).toBeNull();

      // Create new worker instance (simulating app restart)
      const publisherWorker = new OutboxPublisherWorker(mockConfig, em);
      await publisherWorker.processBatch();

      // Verify message now published
      const freshEm = orm.em.fork();
      outboxMsg = await freshEm.findOne(OutboxMessageEntity, { id: outboxMsgId }) as any;
      expect(outboxMsg?.publishedAt).toBeDefined();
      expect(outboxMsg?.publishedAt).not.toBeNull();
    });
  });

  describe('Publisher concurrency', () => {
    it('should publish all pending rows with two publisher instances (no row lost)', async () => {
      // Clean up any leftover outbox messages from other tests
      await em.getConnection().execute('TRUNCATE TABLE outbox_message');
      
      // Create 200 pending outbox messages
      const messages: any[] = [];
      for (let i = 0; i < 200; i++) {
        messages.push({
          id: v4(),
          aggregateId: v4(),
          eventType: 'WagerTransactionProcessed',
          payload: { index: i },
          occurredAt: new Date(),
          attempts: 0,
          nextAttemptAt: null,
          publishedAt: null,
        });
      }

      for (const msg of messages) {
        await em.persist(em.create(OutboxMessageEntity, msg as any));
      }
      await em.flush();

      // Run both publisher instances until all messages are processed
      const publisher1 = new OutboxPublisherWorker(mockConfig, em);
      const publisher2 = new OutboxPublisherWorker(mockConfig, em);

      // Each batch processes 10 messages, need 20 batches total for 200 messages
      // Alternate between publishers to simulate concurrent processing
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          await publisher1.processBatch();
        } else {
          await publisher2.processBatch();
        }
      }

      // Verify all 200 messages published
      const freshEm = orm.em.fork();
      const publishedCount = await freshEm.count(OutboxMessageEntity, { publishedAt: { $ne: null } } as any);
      expect(publishedCount).toBe(200);

      // Verify no pending messages remain
      const pendingCount = await freshEm.count(OutboxMessageEntity, { publishedAt: null } as any);
      expect(pendingCount).toBe(0);
    });
  });
});