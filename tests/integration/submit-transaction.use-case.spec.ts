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
import { IdempotencyConflictError, ReferenceResolutionError } from '../../src/domain/errors';
import { MikroOrmWagerTransactionRepository } from '../../src/database/repositories';
import type { SubmitTransactionCommand } from '../../src/modules/wagering/submit-transaction.use-case';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

describe('SubmitTransactionUseCase happy path (T026 cycle A)', () => {
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
  }, 60_000);

  afterAll(async () => {
    await truncate(orm.em.fork());
    await orm.close();
    await releaseTestLock();
  }, 60_000);

  const newWallet = async (amount = '1000.00') => {
    const playerId = v4();
    const wallet = await wallets.create({
      playerId,
      initialBalance: { amount, currency: 'BRL' },
    });
    return { id: wallet.id, playerId };
  };

  it('processes a BET: locks wallet, debits, writes ledger, snapshots result_balance, emits events', async () => {
    const { id: walletId, playerId } = await newWallet();
    const externalTransactionId = `ext-${v4()}`;

    const result = await submit({ walletId, playerId, externalTransactionId, amount: '100.00' });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.idempotentReplay).toBe(false);
    expect(result.balance).toEqual({ amount: '900.00', currency: 'BRL' });
    expect(typeof result.transactionId).toBe('string');

    const view = orm.em.fork();
    const txRows = (await view.getConnection().execute(
      'SELECT id, status, failure_code, result_balance_amount, payload_hash FROM wager_transaction WHERE id = ?',
      [result.transactionId],
    )) as {
      id: string;
      status: string;
      failure_code: string | null;
      result_balance_amount: string;
      payload_hash: string;
    }[];
    expect(txRows).toHaveLength(1);
    expect(txRows[0]!.status).toBe('PROCESSED');
    expect(txRows[0]!.failure_code).toBeNull();
    expect(txRows[0]!.result_balance_amount).toBe('900.00');
    expect(txRows[0]!.payload_hash).toMatch(/^[0-9a-f]{64}$/);

    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
    expect(entries).toHaveLength(2);
    const bet = entries.find((e) => e.transactionId === result.transactionId);
    expect(bet).toBeDefined();
    expect(bet!.direction).toBe(LedgerDirection.Debit);
    expect(bet!.money.amount).toBe('100.00');
    expect(bet!.balanceBefore.amount).toBe('1000.00');
    expect(bet!.balanceAfter.amount).toBe('900.00');

    const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
    expect(storedWallet!.balance.amount).toBe('900.00');
    expect(storedWallet!.version).toBe(2);

    const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
    const processed = outbox.find(
      (m) => m.eventType === 'WagerTransactionProcessed' && m.aggregateId === result.transactionId,
    );
    expect(processed).toBeDefined();
    expect(processed!.payload['walletId']).toBe(walletId);
    expect(processed!.payload['money']).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(processed!.payload['balanceAfter']).toEqual({ amount: '900.00', currency: 'BRL' });
    expect(processed!.payload['walletVersion']).toBe(2);
    const changed = outbox.find(
      (m) =>
        m.eventType === 'WalletBalanceChanged' &&
        m.aggregateId === walletId &&
        m.payload['transactionId'] === result.transactionId,
    );
    expect(changed).toBeDefined();
    expect(changed!.payload['walletVersion']).toBe(2);
  });

  it('processes a WIN: credits the wallet with a CREDIT ledger entry', async () => {
    const { id: walletId, playerId } = await newWallet();
    const result = await submit({
      walletId,
      playerId,
      kind: WagerTransactionKind.Win,
      amount: '150.00',
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '1150.00', currency: 'BRL' });

    const view = orm.em.fork();
    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
    const win = entries.find((e) => e.transactionId === result.transactionId);
    expect(win).toBeDefined();
    expect(win!.direction).toBe(LedgerDirection.Credit);
    expect(win!.balanceBefore.amount).toBe('1000.00');
    expect(win!.balanceAfter.amount).toBe('1150.00');
  });

  it('processes a LOSS: no balance change, no ledger entry, no WalletBalanceChanged event', async () => {
    const { id: walletId, playerId } = await newWallet();
    const result = await submit({
      walletId,
      playerId,
      kind: WagerTransactionKind.Loss,
      amount: '100.00',
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

    const view = orm.em.fork();
    const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
    expect(entries).toHaveLength(1); // opening only

    const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
    expect(storedWallet!.balance.amount).toBe('1000.00');
    expect(storedWallet!.version).toBe(1);

    const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
    const processed = outbox.find(
      (m) => m.eventType === 'WagerTransactionProcessed' && m.aggregateId === result.transactionId,
    );
    expect(processed).toBeDefined();
    const changed = outbox.find(
      (m) =>
        m.eventType === 'WalletBalanceChanged' &&
        m.aggregateId === walletId &&
        m.payload['transactionId'] === result.transactionId,
    );
    expect(changed).toBeUndefined();
  });

  it('stores the transaction row with unique provider + external idempotency fields', async () => {
    const { id: walletId, playerId } = await newWallet();
    const externalTransactionId = `ext-${v4()}`;
    await submit({ walletId, playerId, externalTransactionId });

    const view = orm.em.fork();
    const rows = (await view.getConnection().execute(
      'SELECT provider_id, external_transaction_id, idempotency_key FROM wager_transaction WHERE external_transaction_id = ?',
      [externalTransactionId],
    )) as { provider_id: string; external_transaction_id: string; idempotency_key: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider_id).toBe('prov-1');
    expect(rows[0]!.idempotency_key.startsWith('idem-')).toBe(true);
  });

  describe('stored rejections (T026 cycle B)', () => {
    const storedRow = async (transactionId: string) => {
      const view = orm.em.fork();
      const rows = (await view.getConnection().execute(
        'SELECT status, failure_code, result_balance_amount FROM wager_transaction WHERE id = ?',
        [transactionId],
      )) as {
        status: string;
        failure_code: string | null;
        result_balance_amount: string | null;
      }[];
      return rows[0];
    };

    it('rejects insufficient funds: stored REJECTED row, no effects, rejected event', async () => {
      const { id: walletId, playerId } = await newWallet('100.00');
      const result = await submit({ walletId, playerId, amount: '500.00' });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(result.idempotentReplay).toBe(false);
      expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      const row = await storedRow(result.transactionId);
      expect(row!.status).toBe('REJECTED');
      expect(row!.failure_code).toBe('INSUFFICIENT_FUNDS');
      expect(row!.result_balance_amount).toBe('100.00');

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(1); // opening only
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.balance.amount).toBe('100.00');
      expect(storedWallet!.version).toBe(1);

      const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
      const rejected = outbox.find(
        (m) =>
          m.eventType === 'WagerTransactionRejected' && m.aggregateId === result.transactionId,
      );
      expect(rejected).toBeDefined();
      expect(rejected!.payload['failureCode']).toBe('INSUFFICIENT_FUNDS');
      const processed = outbox.find(
        (m) => m.eventType === 'WagerTransactionProcessed' && m.aggregateId === result.transactionId,
      );
      expect(processed).toBeUndefined();
      const changed = outbox.find(
        (m) =>
          m.eventType === 'WalletBalanceChanged' &&
          m.aggregateId === walletId &&
          m.payload['transactionId'] === result.transactionId,
      );
      expect(changed).toBeUndefined();
    });

    it('rejects a currency mismatch even when the kind does not move the balance', async () => {
      const { id: walletId, playerId } = await newWallet('1000.00');
      const result = await submit({ walletId, playerId, currency: 'USD', kind: WagerTransactionKind.Loss });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe('CURRENCY_MISMATCH');
      expect(result.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

      const row = await storedRow(result.transactionId);
      expect(row!.status).toBe('REJECTED');
      expect(row!.failure_code).toBe('CURRENCY_MISMATCH');
      expect(row!.result_balance_amount).toBe('1000.00');

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(1);
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.version).toBe(1);
    });

    it('rejects an unknown wallet with WALLET_NOT_FOUND and no result balance', async () => {
      const walletId = v4();
      const result = await submit({ walletId, playerId: v4() });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe('WALLET_NOT_FOUND');
      expect(result.balance).toBeUndefined();

      const row = await storedRow(result.transactionId);
      expect(row!.status).toBe('REJECTED');
      expect(row!.failure_code).toBe('WALLET_NOT_FOUND');
      expect(row!.result_balance_amount).toBeNull();

      const view = orm.em.fork();
      const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
      const rejected = outbox.find(
        (m) =>
          m.eventType === 'WagerTransactionRejected' && m.aggregateId === result.transactionId,
      );
      expect(rejected).toBeDefined();
      expect(rejected!.payload['failureCode']).toBe('WALLET_NOT_FOUND');
      expect(rejected!.payload['walletId']).toBe(walletId);
    });

    it('rejects a mismatched playerId with WALLET_NOT_FOUND and no result balance', async () => {
      const { id: walletId } = await newWallet('1000.00');
      const wrongPlayerId = v4();
      const result = await submit({ walletId, playerId: wrongPlayerId });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe('WALLET_NOT_FOUND');
      expect(result.balance).toBeUndefined();

      const view = orm.em.fork();
      const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
      const rejected = outbox.find(
        (m) =>
          m.eventType === 'WagerTransactionRejected' && m.aggregateId === result.transactionId,
      );
      expect(rejected).toBeDefined();
      expect(rejected!.payload['failureCode']).toBe('WALLET_NOT_FOUND');
    });
  });

  describe('reference resolution REFUND/ROLLBACK (T026 cycle C)', () => {
    const setupBet = async (amount = '100.00') => {
      const { id: walletId, playerId } = await newWallet('1000.00');
      const roundId = v4();
      const betExternal = `ext-${v4()}`;
      const bet = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Bet,
        amount,
        roundId,
        externalTransactionId: betExternal,
      });
      expect(bet.status).toBe(WagerTransactionStatus.Processed);
      return { walletId, playerId, roundId, betExternal, betId: bet.transactionId };
    };

    const referenceRow = async (transactionId: string) => {
      const view = orm.em.fork();
      const rows = (await view.getConnection().execute(
        'SELECT status, failure_code, reference_transaction_id FROM wager_transaction WHERE id = ?',
        [transactionId],
      )) as {
        status: string;
        failure_code: string | null;
        reference_transaction_id: string | null;
      }[];
      return rows[0];
    };

    it('processes a REFUND of a BET: credit back, links reference, per-type reversal slot', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet();
      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });

      expect(refund.status).toBe(WagerTransactionStatus.Processed);
      expect(refund.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

      const view = orm.em.fork();
      const betRow = (
        (await view.getConnection().execute(
          'SELECT id FROM wager_transaction WHERE external_transaction_id = ? AND kind = ?',
          [betExternal, 'BET'],
        )) as { id: string }[]
      )[0];
      const row = await referenceRow(refund.transactionId);
      expect(row!.status).toBe('PROCESSED');
      expect(row!.reference_transaction_id).toBe(betRow!.id);

      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      const refundEntry = entries.find((e) => e.transactionId === refund.transactionId);
      expect(refundEntry).toBeDefined();
      expect(refundEntry!.direction).toBe(LedgerDirection.Credit);
      expect(refundEntry!.balanceAfter.amount).toBe('1000.00');
    });

    it('rejects a second same-type REFUND on the same reference (per-type single reversal)', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet();
      const first = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(first.status).toBe(WagerTransactionStatus.Processed);

      const second = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(second.status).toBe(WagerTransactionStatus.Rejected);
      expect(second.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
      expect(second.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

      const row = await referenceRow(second.transactionId);
      expect(row!.status).toBe('REJECTED');
      expect(row!.failure_code).toBe('REFERENCE_ALREADY_REVERSED');
    });

    it('allows a ROLLBACK after a REFUND on the same reference (mixed-type)', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet();
      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Processed);

      const rollback = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Rollback,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(rollback.status).toBe(WagerTransactionStatus.Processed);
      expect(rollback.balance).toEqual({ amount: '1100.00', currency: 'BRL' });

      const row = await referenceRow(rollback.transactionId);
      expect(row!.reference_transaction_id).not.toBeNull();

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      const rollbackEntry = entries.find((e) => e.transactionId === rollback.transactionId);
      expect(rollbackEntry!.direction).toBe(LedgerDirection.Credit);
    });

    it('rejects a second same-type ROLLBACK on the same reference', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet();
      for (let i = 0; i < 2; i++) {
        const rollback = await submit({
          walletId,
          playerId,
          kind: WagerTransactionKind.Rollback,
          amount: '100.00',
          roundId,
          referenceExternalTransactionId: betExternal,
        });
        if (i === 0) {
          expect(rollback.status).toBe(WagerTransactionStatus.Processed);
        } else {
          expect(rollback.status).toBe(WagerTransactionStatus.Rejected);
          expect(rollback.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
        }
      }
    });

    it('rejects a REFUND referencing a WIN (kind rule: REFUND → BET only)', async () => {
      const { id: walletId, playerId } = await newWallet('1000.00');
      const roundId = v4();
      const winExternal = `ext-${v4()}`;
      const win = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Win,
        amount: '500.00',
        roundId,
        externalTransactionId: winExternal,
      });
      expect(win.status).toBe(WagerTransactionStatus.Processed);

      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '500.00',
        roundId,
        referenceExternalTransactionId: winExternal,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Rejected);
      expect(refund.failureCode).toBe('REFERENCE_INVALID_KIND');
      expect(refund.balance).toEqual({ amount: '1500.00', currency: 'BRL' });
    });

    it('stores PENDING_REFERENCE with balance snapshot and event when the reference is absent', async () => {
      const { walletId, playerId, roundId } = await setupBet();
      const missingRef = `missing-${v4()}`;
      const pending = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: missingRef,
      });

      expect(pending.status).toBe(WagerTransactionStatus.PendingReference);
      expect(pending.failureCode).toBeUndefined();
      expect(pending.balance).toEqual({ amount: '900.00', currency: 'BRL' });

      const row = await referenceRow(pending.transactionId);
      expect(row!.status).toBe('PENDING_REFERENCE');
      expect(row!.reference_transaction_id).toBeNull();

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(2); // opening + bet only
      const outbox = await new MikroOrmOutboxMessageRepository(view).findPending();
      const event = outbox.find(
        (m) =>
          m.eventType === 'WagerTransactionPendingReference' &&
          m.aggregateId === pending.transactionId,
      );
      expect(event).toBeDefined();
      expect(event!.payload['referenceExternalTransactionId']).toBe(missingRef);
    });

    it('rejects a reference from a different round with REFERENCE_MISMATCH', async () => {
      const { walletId, playerId, betExternal } = await setupBet();
      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId: v4(), // different round than the referenced BET
        referenceExternalTransactionId: betExternal,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Rejected);
      expect(refund.failureCode).toBe('REFERENCE_MISMATCH');
    });

    it('rejects a REFUND of a REJECTED reference with REFERENCE_NOT_PROCESSED', async () => {
      const { id: walletId, playerId } = await newWallet('100.00');
      const roundId = v4();
      const betExternal = `ext-${v4()}`;
      // Submit a BET with insufficient funds → REJECTED
      const bet = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Bet,
        amount: '500.00',
        roundId,
        externalTransactionId: betExternal,
      });
      expect(bet.status).toBe(WagerTransactionStatus.Rejected);
      expect(bet.failureCode).toBe('INSUFFICIENT_FUNDS');

      // Now try to REFUND that REJECTED bet
      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '500.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Rejected);
      expect(refund.failureCode).toBe('REFERENCE_NOT_PROCESSED');
      expect(refund.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(1); // opening only, no refund movement
    });

    it('rejects a REFUND with amount different from reference with REFERENCE_AMOUNT_MISMATCH', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet('250.00');
      // Try to refund 100.00 instead of 250.00
      const refund = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Refund,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(refund.status).toBe(WagerTransactionStatus.Rejected);
      expect(refund.failureCode).toBe('REFERENCE_AMOUNT_MISMATCH');
      expect(refund.balance).toEqual({ amount: '750.00', currency: 'BRL' });

      const view = orm.em.fork();
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(2); // opening + bet only, no refund movement
    });

    it('rejects a ROLLBACK whose debit would exceed the balance with REVERSAL_EXCEEDS_BALANCE', async () => {
      const { id: walletId, playerId } = await newWallet('1000.00');
      const roundId = v4();
      const winExternal = `ext-${v4()}`;
      const win = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Win,
        amount: '500.00',
        roundId,
        externalTransactionId: winExternal,
      });
      expect(win.status).toBe(WagerTransactionStatus.Processed);
      const bet = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Bet,
        amount: '1400.00',
        roundId,
      });
      expect(bet.status).toBe(WagerTransactionStatus.Processed);
      expect(bet.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      const rollback = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Rollback,
        amount: '500.00',
        roundId,
        referenceExternalTransactionId: winExternal,
      });
      expect(rollback.status).toBe(WagerTransactionStatus.Rejected);
      expect(rollback.failureCode).toBe('REVERSAL_EXCEEDS_BALANCE');
      expect(rollback.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      const view = orm.em.fork();
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.balance.amount).toBe('100.00');
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries.some((e) => e.transactionId === rollback.transactionId)).toBe(false);
    });

    it('classifies a same-reference reversal race as 422, not a 500 (review IM-3)', async () => {
      const { walletId, playerId, roundId, betExternal } = await setupBet();
      const first = await submit({
        walletId,
        playerId,
        kind: WagerTransactionKind.Rollback,
        amount: '100.00',
        roundId,
        referenceExternalTransactionId: betExternal,
      });
      expect(first.status).toBe(WagerTransactionStatus.Processed);

      // Simulate the race: both the first transaction and its retry observe no
      // applied reversal (the winner committed between check and insert), so
      // the insert hits uq_wager_tx_reference_kind twice.
      const proto = MikroOrmWagerTransactionRepository.prototype;
      const original = proto.findAppliedReversal;
      let misses = 2;
      proto.findAppliedReversal = async function (
        this: MikroOrmWagerTransactionRepository,
        referenceId: string,
        kind: WagerTransactionKind,
      ) {
        if (misses > 0) {
          misses -= 1;
          return null;
        }
        return original.call(this, referenceId, kind);
      } as typeof proto.findAppliedReversal;
      try {
        await expect(
          submit({
            walletId,
            playerId,
            kind: WagerTransactionKind.Rollback,
            amount: '100.00',
            roundId,
            referenceExternalTransactionId: betExternal,
          }),
        ).rejects.toThrow(ReferenceResolutionError);
      } finally {
        proto.findAppliedReversal = original;
      }

      const view = orm.em.fork();
      const rollbacks = (await view.getConnection().execute(
        "SELECT COUNT(*)::int AS n FROM wager_transaction WHERE wallet_id = ? AND kind = 'ROLLBACK' AND status = 'PROCESSED'",
        [walletId],
      )) as { n: number }[];
      expect(rollbacks[0]!.n).toBe(1);
    });
  });

  describe('idempotency (T026 cycle D / T026a / T026b)', () => {
    it('replays a stored success with the original balance and no new effects', async () => {
      const { id: walletId, playerId } = await newWallet();
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '100.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' as const },
      };
      const first = await submit(cmd);
      expect(first.status).toBe(WagerTransactionStatus.Processed);
      expect(first.balance).toEqual({ amount: '900.00', currency: 'BRL' });

      const second = await submit(cmd);
      expect(second.idempotentReplay).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
      expect(second.status).toBe(WagerTransactionStatus.Processed);
      expect(second.balance).toEqual({ amount: '900.00', currency: 'BRL' });
      expect(second.failureCode).toBeUndefined();

      const view = orm.em.fork();
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.balance.amount).toBe('900.00');
      expect(storedWallet!.version).toBe(2); // no second debit
      const entries = await new MikroOrmWalletLedgerEntryRepository(view).findByWalletId(walletId);
      expect(entries).toHaveLength(2); // opening + one bet
      const txCount = (await view.getConnection().execute(
        'SELECT COUNT(*)::int AS n FROM wager_transaction WHERE idempotency_key = ?',
        [cmd.idempotencyKey],
      )) as { n: number }[];
      expect(txCount[0]!.n).toBe(1);
    });

    it('throws IdempotencyConflictError for the same key with a different payload', async () => {
      const { id: walletId, playerId } = await newWallet();
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '100.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' as const },
      };
      await submit(cmd);
      await expect(submit({ ...cmd, amount: '200.00' })).rejects.toThrow(
        IdempotencyConflictError,
      );

      const view = orm.em.fork();
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.balance.amount).toBe('900.00');
    });

    it('replays a stored rejection with idempotentReplay: true', async () => {
      const { id: walletId, playerId } = await newWallet('100.00');
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '500.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' as const },
      };
      const first = await submit(cmd);
      expect(first.status).toBe(WagerTransactionStatus.Rejected);
      expect(first.failureCode).toBe('INSUFFICIENT_FUNDS');

      const second = await submit(cmd);
      expect(second.idempotentReplay).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
      expect(second.status).toBe(WagerTransactionStatus.Rejected);
      expect(second.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(second.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    });

    it('replays a stored PENDING_REFERENCE with the snapshot balance', async () => {
      const { id: walletId, playerId } = await newWallet();
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Refund,
        amount: '10.00',
        currency: 'BRL',
        referenceExternalTransactionId: `missing-${v4()}`,
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' as const },
      };
      const first = await submit(cmd);
      expect(first.status).toBe(WagerTransactionStatus.PendingReference);

      const second = await submit(cmd);
      expect(second.idempotentReplay).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
      expect(second.status).toBe(WagerTransactionStatus.PendingReference);
      expect(second.balance).toEqual({ amount: '1000.00', currency: 'BRL' });
    });

    it('resolves a concurrent duplicate insert by re-resolving in a fresh transaction (G1)', async () => {
      const { id: walletId, playerId } = await newWallet();
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '100.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'http' as const },
      };
      const first = await submit(cmd);
      expect(first.status).toBe(WagerTransactionStatus.Processed);

      // Simulate the G1 race: the winner commits after our lookup misses, so
      // the insert hits uq_wager_tx_idempotency_key and the tx rolls back.
      const proto = MikroOrmWagerTransactionRepository.prototype;
      const original = proto.findByIdempotencyKey;
      let misses = 1;
      proto.findByIdempotencyKey = async function (
        this: MikroOrmWagerTransactionRepository,
        key: string,
      ) {
        if (misses > 0) {
          misses -= 1;
          return null;
        }
        return original.call(this, key);
      } as typeof proto.findByIdempotencyKey;
      try {
        const second = await submit(cmd);
        expect(second.idempotentReplay).toBe(true);
        expect(second.transactionId).toBe(first.transactionId);
        expect(second.balance).toEqual({ amount: '900.00', currency: 'BRL' });
      } finally {
        proto.findByIdempotencyKey = original;
      }

      const view = orm.em.fork();
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.balance.amount).toBe('900.00');
      expect(storedWallet!.version).toBe(2);
      const txCount = (await view.getConnection().execute(
        'SELECT COUNT(*)::int AS n FROM wager_transaction WHERE idempotency_key = ?',
        [cmd.idempotencyKey],
      )) as { n: number }[];
      expect(txCount[0]!.n).toBe(1);
    });

    it('dedups duplicate SQS deliveries through the inbox (T026 step 1)', async () => {
      const { id: walletId, playerId } = await newWallet();
      const messageId = v4();
      const cmd = {
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        walletId,
        playerId,
        roundId: v4(),
        gameId: v4(),
        kind: WagerTransactionKind.Bet,
        amount: '100.00',
        currency: 'BRL',
        idempotencyKey: `idem-${v4()}`,
        ingress: { kind: 'sqs' as const, messageId, consumerName: 'submit-worker' },
      };
      const first = await submit(cmd);
      expect(first.status).toBe(WagerTransactionStatus.Processed);

      const second = await submit(cmd);
      expect(second.idempotentReplay).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
      expect(second.balance).toEqual({ amount: '900.00', currency: 'BRL' });

      const view = orm.em.fork();
      const inboxCount = (await view.getConnection().execute(
        'SELECT COUNT(*)::int AS n FROM inbox_message WHERE message_id = ? AND consumer_name = ?',
        [messageId, 'submit-worker'],
      )) as { n: number }[];
      expect(inboxCount[0]!.n).toBe(1);
      const storedWallet = await new MikroOrmWalletRepository(view).findById(walletId);
      expect(storedWallet!.version).toBe(2);
    });

    it('throws IdempotencyConflictError when the external id is reused under another key (review CR-5)', async () => {
      const { id: walletId, playerId } = await newWallet();
      const externalTransactionId = `ext-${v4()}`;
      const first = await submit({ walletId, playerId, externalTransactionId });
      expect(first.status).toBe(WagerTransactionStatus.Processed);

      await expect(submit({ walletId, playerId, externalTransactionId })).rejects.toThrow(
        IdempotencyConflictError,
      );
    });
  });
});
