import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { WagerTransactionEntity } from '../../../src/database/entities/wager-transaction.entity';
import { WalletEntity } from '../../../src/database/entities/wallet.entity';

describe('WagerTransactionEntity', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [WalletEntity, WagerTransactionEntity],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
    });
    em = orm.em.fork();
    // Schema is owned by migration 001; clean rows so runs are idempotent.
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('should create a pending transaction', async () => {
    const tx = em.create(WagerTransactionEntity, {
      providerId: 'provider-1',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-1:ext-1',
      payloadHash: 'hash123',
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      roundId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2',
      gameId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a3',
      kind: 'BET',
      moneyAmount: '50.00',
      moneyCurrency: 'BRL',
      referenceExternalTransactionId: undefined,
    } as never) as any;

    await em.persist(tx).flush();

    expect(tx.id).toBeDefined();
    expect(tx.status).toBe('PENDING');
    expect(tx.kind).toBe('BET');
    expect(tx.moneyAmount).toBe('50.00');
    expect(tx.moneyCurrency).toBe('BRL');
    expect(tx.referenceExternalTransactionId).toBeUndefined();
  });

  it('should require referenceExternalTransactionId for REFUND', async () => {
    const tx = em.create(WagerTransactionEntity, {
      providerId: 'provider-1',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-1:ext-2',
      payloadHash: 'hash123',
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      roundId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2',
      gameId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a3',
      kind: 'REFUND',
      moneyAmount: '50.00',
      moneyCurrency: 'BRL',
      referenceExternalTransactionId: undefined,
    } as never) as any;
    em.persist(tx);

    await expect(em.flush()).rejects.toThrow();
  });

  it('should require referenceExternalTransactionId for ROLLBACK', async () => {
    const tx = em.create(WagerTransactionEntity, {
      providerId: 'provider-1',
      externalTransactionId: 'ext-3',
      idempotencyKey: 'provider-1:ext-3',
      payloadHash: 'hash123',
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      roundId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2',
      gameId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a3',
      kind: 'ROLLBACK',
      moneyAmount: '50.00',
      moneyCurrency: 'BRL',
      referenceExternalTransactionId: undefined,
    } as never) as any;
    em.persist(tx);

    await expect(em.flush()).rejects.toThrow();
  });
});