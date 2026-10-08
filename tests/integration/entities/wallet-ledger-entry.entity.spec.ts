import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { WalletLedgerEntryEntity } from '../../../src/database/entities/wallet-ledger-entry.entity';
import { WalletEntity } from '../../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../../src/database/entities/wager-transaction.entity';

describe('WalletLedgerEntryEntity', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [WalletEntity, WagerTransactionEntity, WalletLedgerEntryEntity],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
    });
    em = orm.em.fork();
    // Schema is owned by migration 001; the immutability trigger blocks DELETE,
    // so clean rows with TRUNCATE (row triggers do not fire on TRUNCATE).
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('should create a valid DEBIT entry', async () => {
    const entry = em.create(WalletLedgerEntryEntity, {
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      transactionId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b1',
      direction: 'DEBIT',
      moneyAmount: '30.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '70.00',
      balanceAfterCurrency: 'BRL',
    } as never) as any;

    await em.persist(entry).flush();

    expect(entry.id).toBeDefined();
    expect(entry.direction).toBe('DEBIT');
    expect(entry.moneyAmount).toBe('30.00');
    expect(entry.balanceBeforeAmount).toBe('100.00');
    expect(entry.balanceAfterAmount).toBe('70.00');
  });

  it('should create a valid CREDIT entry', async () => {
    const entry = em.create(WalletLedgerEntryEntity, {
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      transactionId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b2',
      direction: 'CREDIT',
      moneyAmount: '50.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '50.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '100.00',
      balanceAfterCurrency: 'BRL',
    } as never) as any;

    await em.persist(entry).flush();

    expect(entry.direction).toBe('CREDIT');
    expect(entry.balanceAfterAmount).toBe('100.00');
  });

  it('should reject unbalanced DEBIT entry', async () => {
    const entry = em.create(WalletLedgerEntryEntity, {
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      transactionId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b1',
      direction: 'DEBIT',
      moneyAmount: '30.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '69.00',
      balanceAfterCurrency: 'BRL',
    } as never) as any;
    em.persist(entry);

    await expect(em.flush()).rejects.toThrow();
  });

  it('should reject unbalanced CREDIT entry', async () => {
    const entry = em.create(WalletLedgerEntryEntity, {
      walletId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      transactionId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b2',
      direction: 'CREDIT',
      moneyAmount: '50.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '50.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '99.00',
      balanceAfterCurrency: 'BRL',
    } as never) as any;
    em.persist(entry);

    await expect(em.flush()).rejects.toThrow();
  });
});