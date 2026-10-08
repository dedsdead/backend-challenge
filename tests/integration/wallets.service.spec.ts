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
import { WalletExistsError, NotFoundError } from '../../src/domain/errors';
import { LedgerDirection } from '../../src/domain/enums';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

describe('WalletsService.create / get (T025)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let service: WalletsService;

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
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
    service = new WalletsService(em);
  }, 60_000);

  afterAll(async () => {
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
    await orm.close();
    await releaseTestLock();
  }, 60_000);

  it('creates a wallet with version 1 and the initial balance', async () => {
    const playerId = v4();
    const wallet = await service.create({
      playerId,
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(wallet.version).toBe(1);
    expect(wallet.balance.amount).toBe('1000.00');
    expect(wallet.balance.currency).toBe('BRL');
    expect(wallet.playerId).toBe(playerId);
  });

  it('persists OPENING transaction, CREDIT ledger entry, and opening outbox event when initialBalance > 0', async () => {
    const playerId = v4();
    const wallet = await service.create({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const view = orm.em.fork();

    const rows = (await view.getConnection().execute(
      'SELECT id, kind, status, result_balance_amount FROM wager_transaction WHERE wallet_id = ?',
      [wallet.id],
    )) as { id: string; kind: string; status: string; result_balance_amount: string }[];
    const opening = rows.find((r) => r.kind === 'OPENING');
    expect(opening).toBeDefined();
    expect(opening!.status).toBe('PROCESSED');
    expect(opening!.result_balance_amount).toBe('100.00');

    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(wallet.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe(LedgerDirection.Credit);
    expect(entries[0]!.money.amount).toBe('100.00');
    expect(entries[0]!.balanceBefore.amount).toBe('0.00');
    expect(entries[0]!.balanceAfter.amount).toBe('100.00');
    expect(entries[0]!.transactionId).toBe(opening!.id);

    const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
    const openingEvent = outbox.find((m) => m.eventType === 'WalletBalanceChanged' && m.aggregateId === wallet.id);
    expect(openingEvent).toBeDefined();
    expect(openingEvent!.payload['transactionId']).toBe(opening!.id);
    expect(openingEvent!.payload['walletVersion']).toBe(1);
  });

  it('creates only the wallet row for a zero initial balance', async () => {
    const playerId = v4();
    const wallet = await service.create({
      playerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });
    const view = orm.em.fork();

    expect(wallet.version).toBe(1);
    expect(wallet.balance.amount).toBe('0.00');
    const txCount = (await view.getConnection().execute(
      'SELECT COUNT(*)::int AS n FROM wager_transaction WHERE wallet_id = ?',
      [wallet.id],
    )) as { n: number }[];
    expect(txCount[0]!.n).toBe(0);
    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(wallet.id);
    expect(entries).toHaveLength(0);
  });

  it('rejects a duplicate playerId + currency with WalletExistsError and persists nothing', async () => {
    const playerId = v4();
    await service.create({
      playerId,
      initialBalance: { amount: '10.00', currency: 'BRL' },
    });
    await expect(
      service.create({
        playerId,
        initialBalance: { amount: '99.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(WalletExistsError);

    const view = orm.em.fork();
    const stored = await new MikroOrmWalletRepository(view).findByPlayerIdAndCurrency(playerId, 'BRL');
    expect(stored?.balance.amount).toBe('10.00');
  });

  it('allows the same player with a different currency', async () => {
    const playerId = v4();
    const brl = await service.create({
      playerId,
      initialBalance: { amount: '10.00', currency: 'BRL' },
    });
    const usd = await service.create({
      playerId,
      initialBalance: { amount: '5.00', currency: 'USD' },
    });
    expect(brl.id).not.toBe(usd.id);
    expect(usd.balance.currency).toBe('USD');
  });

  it('get returns a stored wallet', async () => {
    const playerId = v4();
    const created = await service.create({
      playerId,
      initialBalance: { amount: '42.00', currency: 'BRL' },
    });
    const found = await service.get(created.id);
    expect(found.id).toBe(created.id);
    expect(found.balance.amount).toBe('42.00');
  });

  it('get throws NotFoundError for an unknown wallet', async () => {
    await expect(service.get(v4())).rejects.toThrow(NotFoundError);
  });
});
