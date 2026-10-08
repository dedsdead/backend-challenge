import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { v4 } from 'uuid';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/database/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../src/database/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
import {
  MikroOrmWalletRepository,
  MikroOrmWalletLedgerEntryRepository,
  MikroOrmWagerTransactionRepository,
} from '../../src/database/repositories';
import { WalletsService } from '../../src/modules/wallets/wallets.service';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/enums';
import type { SubmitTransactionCommand } from '../../src/modules/wagering/submit-transaction.use-case';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

describe('Concurrency: Multi-instance scenario', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let wallets: WalletsService;
  let submit: (cmd: Partial<SubmitTransactionCommand> & { walletId: string; playerId: string }) => Promise<{
    transactionId: string;
    status: string;
    balance?: { amount: string; currency: string };
    idempotentReplay: boolean;
    failureCode?: string;
  }>;

  const truncate = async (view: EntityManager) => {
    await view.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await view.nativeDelete(WagerTransactionEntity, {} as never);
    await view.nativeDelete(WalletEntity, {} as never);
    await view.nativeDelete(InboxMessageEntity, {} as never);
    await view.nativeDelete(OutboxMessageEntity, {} as never);
  };

  beforeAll(async () => {
    await acquireTestLock();
    orm = await MikroORM.init({
      entities: [
        WalletEntity,
        WagerTransactionEntity,
        WalletLedgerEntryEntity,
        InboxMessageEntity,
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
    wallets = new WalletsService(em);
    const { SubmitTransactionUseCase } = await import(
      '../../src/modules/wagering/submit-transaction.use-case'
    );
    const useCase = new SubmitTransactionUseCase(em);
    submit = (overrides) =>
      useCase.execute({
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '100.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' },
        ...overrides,
      } as SubmitTransactionCommand);
  }, 15_000);

  afterAll(async () => {
    await truncate(orm.em.fork());
    await orm.close();
    await releaseTestLock();
  }, 15_000);

  const newWallet = async (amount = '1000.00') => {
    const playerId = v4();
    const wallet = await wallets.create({
      playerId,
      initialBalance: { amount, currency: 'BRL' },
    });
    return { id: wallet.id, playerId };
  };

  it('mixed workload with shared + distinct wallets: final invariant balance == sum(ledger) and no duplicate debits', async () => {
    // Create 5 wallets: 2 shared (will receive concurrent bets), 3 distinct
    const sharedWallet1 = await newWallet('1000.00');
    const sharedWallet2 = await newWallet('1000.00');
    const distinctWallets = await Promise.all([
      newWallet('500.00'),
      newWallet('500.00'),
      newWallet('500.00'),
    ]);

    // Fire mixed workload: concurrent bets on shared wallets + single bets on distinct wallets
    const promises: Promise<{
      transactionId: string;
      status: string;
      balance?: { amount: string; currency: string };
      idempotentReplay: boolean;
      failureCode?: string;
    }>[] = [];

    // Shared wallet 1: 10 concurrent bets of 50.00 each (max 2 can succeed)
    for (let i = 0; i < 10; i++) {
      promises.push(
        submit({
          walletId: sharedWallet1.id,
          playerId: sharedWallet1.playerId,
          amount: '50.00',
        })
      );
    }

    // Shared wallet 2: 10 concurrent bets of 75.00 each (max 1 can succeed)
    for (let i = 0; i < 10; i++) {
      promises.push(
        submit({
          walletId: sharedWallet2.id,
          playerId: sharedWallet2.playerId,
          amount: '75.00',
        })
      );
    }

    // Distinct wallets: 1 bet each (all should succeed)
    for (const dw of distinctWallets) {
      promises.push(
        submit({
          walletId: dw.id,
          playerId: dw.playerId,
          amount: '100.00',
        })
      );
    }

    const results = await Promise.all(promises);

    // Verify invariants for all wallets
    const allWalletIds = [
      sharedWallet1.id,
      sharedWallet2.id,
      ...distinctWallets.map((w) => w.id),
    ];

    const view = orm.em.fork();

    for (const walletId of allWalletIds) {
      // Get wallet
      const wallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(wallet).toBeDefined();

      // Get ledger entries
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      const debitEntries = entries.filter((e) => e.direction === LedgerDirection.Debit);
      const creditEntries = entries.filter((e) => e.direction === LedgerDirection.Credit);

      // Calculate sum from ledger (credits - debits)
      let calculatedBalance = 0;
      for (const entry of creditEntries) {
        calculatedBalance += Number(entry.money.amount);
      }
      for (const entry of debitEntries) {
        calculatedBalance -= Number(entry.money.amount);
      }

      // Final invariant: wallet balance == ledger sum
      expect(Number(wallet!.balance.amount)).toBeCloseTo(calculatedBalance, 2);

      // No duplicate debits per transaction (each transaction should have at most one ledger entry)
      const txIds = debitEntries.map((e) => e.transactionId);
      const uniqueTxIds = new Set(txIds);
      expect(txIds.length).toBe(uniqueTxIds.size);
    }

    // Verify total balance across all wallets matches sum of all ledger entries
    let totalWalletBalance = 0;
    let totalLedgerBalance = 0;

    for (const walletId of allWalletIds) {
      const wallet = await new MikroOrmWalletRepository(view).findById(walletId);
      totalWalletBalance += Number(wallet!.balance.amount);

      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      for (const entry of entries) {
        if (entry.direction === LedgerDirection.Credit) {
          totalLedgerBalance += Number(entry.money.amount);
        } else {
          totalLedgerBalance -= Number(entry.money.amount);
        }
      }
    }

    expect(totalWalletBalance).toBeCloseTo(totalLedgerBalance, 2);
  });
});