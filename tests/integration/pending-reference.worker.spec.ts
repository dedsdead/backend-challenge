// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { v4 } from 'uuid';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/database/entities/wallet-ledger-entry.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
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

describe('PendingReferenceWorker (T040)', () => {
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
  }, 15_000);

  afterAll(async () => {
    await truncate(orm.em.fork());
    await orm.close();
  }, 15_000);

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
    await em.flush();
    return txId;
  };

  const createPendingReference = async (em: EntityManager, walletId: string, playerId: string, externalId: string, kind: 'REFUND' | 'ROLLBACK', roundId: string, referenceExternalId: string = 'bet-external-1') => {
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
        kind,
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

  const mockConfig = {
    get: (key: string) => {
      if (key === 'WORKERS_ENABLED') return false;
      return undefined;
    },
    getOrThrow: (key: string) => {
      if (key === 'WORKERS_ENABLED') return false;
      throw new Error(`Missing config: ${key}`);
    },
  } as any;

  it('should resolve pending REFUND when reference BET exists and mark as PROCESSED', async () => {
    const { id: walletId, playerId } = await createWallet(em, '1000.00');
    const roundId = v4();
    await createProcessedBet(em, walletId, playerId, 'bet-external-refund-1', roundId);
    const refundTxId = await createPendingReference(em, walletId, playerId, 'refund-external-1', 'REFUND', roundId, 'bet-external-refund-1');

    const worker = new PendingReferenceWorker(mockConfig, em);
    await worker.processBatch();
    
    // Use a fresh entity manager to avoid identity map caching
const freshEm = orm.em.fork();
    const tx: any = await freshEm.findOne(WagerTransactionEntity, { id: refundTxId });
    expect(tx).toBeDefined();
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.status).toBe('PROCESSED');
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.referenceTransactionId).toBeDefined();
    
    const ledgerEntries: any[] = await em.find(WalletLedgerEntryEntity, { transactionId: refundTxId });
    expect(ledgerEntries.length).toBe(1);
    // @ts-ignore - entity property types are strict in test context
    expect(ledgerEntries[0]?.direction).toBe('CREDIT');
    // @ts-ignore - entity property types are strict in test context
    expect(ledgerEntries[0]?.moneyAmount).toBe('100.00');
    
    const wallet: any = await em.findOne(WalletEntity, { id: walletId });
    // @ts-ignore - entity property types are strict in test context
    expect(wallet?.balanceAmount).toBe('1000.00');
  });

  it('should resolve pending ROLLBACK when reference BET exists and mark as PROCESSED', async () => {
    const { id: walletId, playerId } = await createWallet(em, '1000.00');
    const roundId = v4();
    await createProcessedBet(em, walletId, playerId, 'bet-external-rollback-1', roundId);
    const rollbackTxId = await createPendingReference(em, walletId, playerId, 'rollback-external-1', 'ROLLBACK', roundId, 'bet-external-rollback-1');

    const worker = new PendingReferenceWorker(mockConfig, em);
    await worker.processBatch();
    
    const freshEm = orm.em.fork();
    const tx: any = await freshEm.findOne(WagerTransactionEntity, { id: rollbackTxId });
    expect(tx).toBeDefined();
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.status).toBe('PROCESSED');
    
    const ledgerEntries: any[] = await em.find(WalletLedgerEntryEntity, { transactionId: rollbackTxId });
    expect(ledgerEntries.length).toBe(1);
    // @ts-ignore - entity property types are strict in test context
    expect(ledgerEntries[0]?.direction).toBe('CREDIT');
    // @ts-ignore - entity property types are strict in test context
    expect(ledgerEntries[0]?.moneyAmount).toBe('100.00');
    
    const wallet: any = await em.findOne(WalletEntity, { id: walletId });
    // @ts-ignore - entity property types are strict in test context
    expect(wallet?.balanceAmount).toBe('1000.00');
  });

  it('should reject pending reference after max attempts (10) with REFERENCE_NOT_FOUND', async () => {
    const { id: walletId, playerId } = await createWallet(em, '1000.00');
    const roundId = v4();
    const txId = await createPendingReference(em, walletId, playerId, 'refund-external-2', 'REFUND', roundId, 'non-existent-bet-1');
    
    await em.nativeUpdate(WagerTransactionEntity, { id: txId }, { 
      referenceAttempts: 10,
      referenceNextAttemptAt: new Date(Date.now() - 1000),
    });

    const worker = new PendingReferenceWorker(mockConfig, em);
    await worker.processBatch();
    
    const freshEm = orm.em.fork();
    const tx: any = await freshEm.findOne(WagerTransactionEntity, { id: txId });
    expect(tx).toBeDefined();
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.status).toBe('REJECTED');
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.failureCode).toBe('REFERENCE_NOT_FOUND');
    
    const ledgerEntries: any[] = await freshEm.find(WalletLedgerEntryEntity, { transactionId: txId });
    expect(ledgerEntries.length).toBe(0);
    
    const wallet: any = await freshEm.findOne(WalletEntity, { id: walletId });
    // @ts-ignore - entity property types are strict in test context
    expect(wallet?.balanceAmount).toBe('1000.00');
  });

  it('should schedule retry with exponential backoff when reference not found and attempts < 10', async () => {
    const { id: walletId, playerId } = await createWallet(em, '1000.00');
    const roundId = v4();
    const txId = await createPendingReference(em, walletId, playerId, 'refund-external-3', 'REFUND', roundId, 'non-existent-bet-2');
    
    await em.nativeUpdate(WagerTransactionEntity, { id: txId }, { 
      referenceAttempts: 1,
      referenceNextAttemptAt: new Date(Date.now() - 1000),
    });

    const worker = new PendingReferenceWorker(mockConfig, em);
    await worker.processBatch();
    
    const freshEm = orm.em.fork();
    const tx: any = await freshEm.findOne(WagerTransactionEntity, { id: txId });
    expect(tx).toBeDefined();
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.status).toBe('PENDING_REFERENCE');
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.referenceAttempts).toBe(2);
    
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.referenceNextAttemptAt).toBeDefined();
    const expectedNextAttempt = new Date(Date.now() + 120 * 1000);
    const diff = Math.abs((tx?.referenceNextAttemptAt as Date).getTime() - expectedNextAttempt.getTime());
    expect(diff).toBeLessThan(5000);
  });

  it('should reject pending reference older than 24 hours', async () => {
    const { id: walletId, playerId } = await createWallet(em, '1000.00');
    const roundId = v4();
    const txId = await createPendingReference(em, walletId, playerId, 'refund-external-4', 'REFUND', roundId, 'non-existent-bet-3');
    
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await em.nativeUpdate(WagerTransactionEntity, { id: txId }, { 
      referenceAttempts: 1,
      referenceNextAttemptAt: oldDate,
      createdAt: oldDate,
    });

    const worker = new PendingReferenceWorker(mockConfig, em);
    await worker.processBatch();
    
    const freshEm = orm.em.fork();
    const tx: any = await freshEm.findOne(WagerTransactionEntity, { id: txId });
    expect(tx).toBeDefined();
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.status).toBe('REJECTED');
    // @ts-ignore - entity property types are strict in test context
    expect(tx?.failureCode).toBe('REFERENCE_NOT_FOUND');
  });
});