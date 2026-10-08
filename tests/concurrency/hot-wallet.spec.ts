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
  MikroOrmOutboxMessageRepository,
} from '../../src/database/repositories';
import { WalletsService } from '../../src/modules/wallets/wallets.service';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/enums';
import { MikroOrmWagerTransactionRepository } from '../../src/database/repositories';
import type { SubmitTransactionCommand } from '../../src/modules/wagering/submit-transaction.use-case';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

describe('Concurrency: Hot-wallet scenario (AC-11)', () => {
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

  const newWallet = async (amount = '100.00') => {
    const playerId = v4();
    const wallet = await wallets.create({
      playerId,
      initialBalance: { amount, currency: 'BRL' },
    });
    return { id: wallet.id, playerId };
  };

  it('two concurrent BETs on same wallet: one PROCESSED, one REJECTED INSUFFICIENT_FUNDS, balance 20.00, exactly one DEBIT ledger entry', async () => {
    const { id: walletId, playerId } = await newWallet('100.00');

    // Fire two 80.00 bets concurrently with distinct idempotency keys
    const [result1, result2] = await Promise.all([
      submit({ walletId, playerId, amount: '80.00' }),
      submit({ walletId, playerId, amount: '80.00' }),
    ]);

    const statuses = [result1.status, result2.status].sort();
    expect(statuses).toEqual(['PROCESSED', 'REJECTED']);

    const processed = result1.status === 'PROCESSED' ? result1 : result2;
    const rejected = result1.status === 'REJECTED' ? result1 : result2;

    expect(processed.balance).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(rejected.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(rejected.balance).toEqual({ amount: '20.00', currency: 'BRL' });

    // Verify exactly one DEBIT ledger entry exists
    const view = orm.em.fork();
    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
    const debitEntries = entries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debitEntries).toHaveLength(1);
    expect(debitEntries[0]!.money.amount).toBe('80.00');
    expect(debitEntries[0]!.balanceAfter.amount).toBe('20.00');

    // Verify final wallet balance
    const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
    expect(storedWallet!.balance.amount).toBe('20.00');
  });
});