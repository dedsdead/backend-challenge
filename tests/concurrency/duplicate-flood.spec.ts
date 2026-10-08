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

describe('Concurrency: 50x duplicate flood (AC-12)', () => {
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

  it('same idempotency key + payload fired 50x in parallel: exactly one stored transaction, one debit, all responses consistent with idempotentReplay on >=49', async () => {
    const { id: walletId, playerId } = await newWallet('1000.00');
    const idempotencyKey = `idem-flood-${v4()}`;
    const externalTransactionId = `ext-flood-${v4()}`;
    const roundId = v4();
    const gameId = v4();

    // Fire 50 concurrent requests with the SAME idempotency key and payload
    const promises = Array.from({ length: 50 }, () =>
      submit({
        walletId,
        playerId,
        idempotencyKey,
        externalTransactionId,
        roundId,
        gameId,
        amount: '25.00',
      })
    );

    const results = await Promise.all(promises);

    // All should succeed (either PROCESSED or idempotent replay)
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 'PROCESSED')).toBe(true);

    // Exactly one should have idempotentReplay: false (the first), 49 should have true
    const replayCounts = results.reduce(
      (acc, r) => {
        acc[r.idempotentReplay ? 'replay' : 'first']++;
        return acc;
      },
      { first: 0, replay: 0 }
    );
    expect(replayCounts.first).toBe(1);
    expect(replayCounts.replay).toBe(49);

    // All responses should have the same transactionId (the first one)
    const firstTxId = results[0]?.transactionId;
    expect(firstTxId).toBeDefined();
    expect(results.every((r) => r.transactionId === firstTxId)).toBe(true);

    // All should have the same balance (975.00 after one 25.00 debit)
    expect(results.every((r) => r.balance?.amount === '975.00')).toBe(true);

    // Verify exactly one stored transaction in DB (OPENING + 1 BET)
    const view = orm.em.fork();
    const txRows = (await view.getConnection().execute(
      'SELECT id, kind, status FROM wager_transaction WHERE wallet_id = ? ORDER BY created_at',
      [walletId]
    )) as { id: string; kind: string; status: string }[];
    expect(txRows).toHaveLength(2);
    expect(txRows[0]!.kind).toBe('OPENING');
    expect(txRows[1]!.kind).toBe('BET');
    expect(txRows[1]!.status).toBe('PROCESSED');

    // Verify exactly one DEBIT ledger entry
    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
    const debitEntries = entries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debitEntries).toHaveLength(1);
    expect(debitEntries[0]!.money.amount).toBe('25.00');
    expect(debitEntries[0]!.balanceAfter.amount).toBe('975.00');

    // Verify final wallet balance
    const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
    expect(storedWallet!.balance.amount).toBe('975.00');
    expect(storedWallet!.version).toBe(2); // OPENING + 1 BET
  });
});