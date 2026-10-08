import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { v4 } from 'uuid';
import { Money } from '../../src/domain/money/money';
import { WalletLedgerEntry } from '../../src/domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../src/domain/enums';
import { MikroOrmWalletLedgerEntryRepository } from '../../src/database/repositories';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { InboxMessageEntity } from '../../src/database/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

// AC ownership note (T029/T029b): this suite exercises the wallets endpoints
// without tokens — guards arrive in plan T044 (Phase 8).

process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';

interface Truncator {
  truncate(): Promise<void>;
}

describe('wallets HTTP API (T025/T029 wallets section)', () => {
  let baseUrl = '';
  let truncate: Truncator['truncate'] = async () => {};

  beforeAll(async () => {
    await acquireTestLock();
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../../src/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP AddressInfo from listen(0)');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    const { MikroORM } = await import('@mikro-orm/core');
    const orm = app.get(MikroORM);
    const em = orm.em.fork();
    truncate = async () => {
      await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
      await em.nativeDelete(WagerTransactionEntity, {} as never);
      await em.nativeDelete(WalletEntity, {} as never);
      await em.nativeDelete(InboxMessageEntity, {} as never);
      await em.nativeDelete(OutboxMessageEntity, {} as never);
    };
    await truncate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__walletsApp = app;
  }, 20_000);

  afterAll(async () => {
    await truncate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (globalThis as any).__walletsApp;
    await app?.close();
    await releaseTestLock();
  }, 20_000);

  const post = (body: unknown) =>
    fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const createWallet = async (amount = '1000.00', currency = 'BRL') => {
    const playerId = v4();
    const res = await post({
      playerId,
      initialBalance: { amount, currency },
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; playerId: string; version: number };
  };

  const seedLedger = async (walletId: string, count: number) => {
    const { MikroORM } = await import('@mikro-orm/core');
    const app = (globalThis as { __walletsApp?: { get: (t: unknown) => unknown } }).__walletsApp;
    const orm = app!.get(MikroORM) as { em: { fork: () => never } };
    const repo = new MikroOrmWalletLedgerEntryRepository(orm.em.fork());
    const base = Date.now();
    let before = Money.from({ amount: '1000.00', currency: 'BRL' });
    for (let i = 0; i < count; i++) {
      const money = Money.from({ amount: '10.00', currency: 'BRL' });
      const after = before.add(money);
      const entry = WalletLedgerEntry.create({
        walletId,
        transactionId: v4(),
        direction: LedgerDirection.Credit,
        money,
        balanceBefore: before,
        balanceAfter: after,
        createdAt: new Date(base + (i + 1) * 1000),
      });
      await repo.save(entry);
      before = after;
    }
  };

  describe('POST /wallets', () => {
    it('creates a wallet with 201 and the documented body (AC-1, AC-20b)', async () => {
      const playerId = v4();
      const res = await post({
        playerId,
        initialBalance: { amount: '1000.00', currency: 'BRL' },
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(['balance', 'id', 'playerId', 'version']);
      expect(body).toMatchObject({
        playerId,
        balance: { amount: '1000.00', currency: 'BRL' },
        version: 1,
      });
      expect(typeof body.id).toBe('string');
    });

    it('returns 409 WALLET_EXISTS for a duplicate player + currency (AC-2)', async () => {
      const playerId = v4();
      expect((await post({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } })).status).toBe(201);
      const dup = await post({ playerId, initialBalance: { amount: '99.00', currency: 'BRL' } });
      expect(dup.status).toBe(409);
      const body = await dup.json();
      expect(body.code).toBe('WALLET_EXISTS');
      expect(body.statusCode).toBe(409);
    });

    it('allows the same player with a different currency (G18)', async () => {
      const playerId = v4();
      expect((await post({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } })).status).toBe(201);
      expect((await post({ playerId, initialBalance: { amount: '5.00', currency: 'USD' } })).status).toBe(201);
    });

    it('rejects an invalid payload with 400 VALIDATION_ERROR and per-field errors (AC-24)', async () => {
      const res = await post({ playerId: 'not-a-uuid', initialBalance: { amount: '10', currency: 'brl' } });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Validation failed');
      expect(Array.isArray(body.errors)).toBe(true);
      const properties = body.errors.map((e: { property: string }) => e.property);
      expect(properties).toContain('playerId');
      expect(properties).toContain('initialBalance.amount');
      expect(properties).toContain('initialBalance.currency');
      for (const error of body.errors) {
        expect(Object.keys(error).sort()).toEqual(['constraints', 'property']);
        expect(typeof error.constraints).toBe('object');
        expect(Object.keys(error.constraints).length).toBeGreaterThan(0);
      }
    });

    it('rejects a payload without initialBalance with 400, not a 500 (review CR-1)', async () => {
      const res = await post({ playerId: v4() });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'initialBalance');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
    });

    it('rejects initialBalance as an empty array with 400, not a 500', async () => {
      const res = await post({ playerId: v4(), initialBalance: [] });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'initialBalance');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
    });

    it('rejects initialBalance as an array of objects with 400, not a 500', async () => {
      const res = await post({ playerId: v4(), initialBalance: [{}] });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'initialBalance');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
    });

    it('rejects unknown fields with 400 (whitelist + forbidNonWhitelisted)', async () => {
      const res = await post({
        playerId: v4(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
        admin: true,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors.map((e: { property: string }) => e.property)).toContain('admin');
    });
  });

  describe('GET /wallets/:walletId', () => {
    it('returns the documented body (AC-20b)', async () => {
      const created = await createWallet('42.00');
      const res = await fetch(`${baseUrl}/wallets/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(['balance', 'id', 'playerId', 'version']);
      expect(body.balance).toEqual({ amount: '42.00', currency: 'BRL' });
      expect(body.version).toBe(1);
    });

    it('returns 404 NOT_FOUND for an unknown wallet (AC-20)', async () => {
      const res = await fetch(`${baseUrl}/wallets/${v4()}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.failureCode).toBeUndefined();
    });

    it('returns 400 VALIDATION_ERROR for a malformed walletId (AC-20a)', async () => {
      const res = await fetch(`${baseUrl}/wallets/not-a-uuid`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /wallets/:walletId/ledger', () => {
    it('returns {entries, nextCursor} newest-first with keyset paging (AC-21)', async () => {
      const wallet = await createWallet('1000.00');
      await seedLedger(wallet.id, 4);

      const p1 = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=2`);
      expect(p1.status).toBe(200);
      const page1 = await p1.json();
      expect(Object.keys(page1).sort()).toEqual(['entries', 'nextCursor']);
      expect(page1.entries).toHaveLength(2);
      expect(typeof page1.nextCursor).toBe('string');
      expect(Object.keys(page1.entries[0]).sort()).toEqual([
        'amount',
        'balanceAfter',
        'balanceBefore',
        'createdAt',
        'direction',
        'id',
        'transactionId',
      ]);

      const p2 = await fetch(
        `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      );
      expect(p2.status).toBe(200);
      const page2 = await p2.json();
      expect(page2.entries).toHaveLength(2);
      expect(page2.nextCursor).toBeTypeOf('string');

      const p3 = await fetch(
        `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`,
      );
      expect(p3.status).toBe(200);
      const page3 = await p3.json();
      expect(page3.entries).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();

      const ids = [...page1.entries, ...page2.entries, ...page3.entries].map(
        (e: { id: string }) => e.id,
      );
      expect(new Set(ids).size).toBe(5);
    });

    it('is stable under inserts between pages (AC-21)', async () => {
      const wallet = await createWallet('1000.00');
      await seedLedger(wallet.id, 4);

      const p1 = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=2`);
      const page1 = await p1.json();
      await seedLedger(wallet.id, 1);
      const p2 = await fetch(
        `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      );
      const page2 = await p2.json();
      const firstIds = page1.entries.map((e: { id: string }) => e.id);
      const secondIds = page2.entries.map((e: { id: string }) => e.id);
      for (const id of firstIds) {
        expect(secondIds).not.toContain(id);
      }
    });

    it('returns an empty envelope for a wallet with no ledger entries (AC-15)', async () => {
      const wallet = await createWallet('0.00');
      const res = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ entries: [], nextCursor: null });
    });

    it('rejects out-of-bounds and non-numeric limits (AC-21a)', async () => {
      const wallet = await createWallet('1000.00');
      for (const limit of ['0', '101', '-1', 'abc']) {
        const res = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=${limit}`);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects an undecodable cursor (AC-21a)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?cursor=!!!garbage!!!`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Invalid ledger cursor');
    });

    it('returns 404 for an unknown wallet (AC-20)', async () => {
      const res = await fetch(`${baseUrl}/wallets/${v4()}/ledger`);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('NOT_FOUND');
    });
  });

  describe('POST /wallets/:walletId/reconciliation (AC-17)', () => {
    const reconcile = (walletId: string) =>
      fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, { method: 'POST' });

    it('reports a consistent wallet with the documented body', async () => {
      const wallet = await createWallet('1000.00');
      const res = await reconcile(wallet.id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual([
        'calculatedBalance',
        'checkedEntries',
        'consistent',
        'difference',
        'storedBalance',
        'walletId',
      ]);
      expect(body).toEqual({
        walletId: wallet.id,
        storedBalance: { amount: '1000.00', currency: 'BRL' },
        calculatedBalance: { amount: '1000.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 1,
      });
    });

    it('reports a zero-balance wallet as consistent with zero entries', async () => {
      const wallet = await createWallet('0.00');
      const res = await reconcile(wallet.id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consistent).toBe(true);
      expect(body.checkedEntries).toBe(0);
      expect(body.difference.amount).toBe('0.00');
    });

    it('flags a seeded divergence, warns, counts the metric, never corrects (AC-17)', async () => {
      const wallet = await createWallet('1000.00');
      await seedLedger(wallet.id, 1); // stored 1000.00, ledger sum 1010.00

      const { metrics } = await import('../../src/common/metrics/metrics');
      const { Logger } = await import('@nestjs/common');
      const before = metrics.reconciliationDivergence.count;
      const warnings: unknown[][] = [];
      const originalWarn = Logger.prototype.warn;
      Logger.prototype.warn = function (this: unknown, ...args: unknown[]) {
        warnings.push(args);
        return originalWarn.apply(this, args as never);
      };
      let res: Response;
      try {
        res = await reconcile(wallet.id);
      } finally {
        Logger.prototype.warn = originalWarn;
      }

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consistent).toBe(false);
      expect(body.difference).toEqual({ amount: '-10.00', currency: 'BRL' });
      expect(body.storedBalance).toEqual({ amount: '1000.00', currency: 'BRL' });
      expect(body.calculatedBalance).toEqual({ amount: '1010.00', currency: 'BRL' });
      expect(body.checkedEntries).toBe(2);
      expect(metrics.reconciliationDivergence.count).toBe(before + 1);
      expect(warnings.length).toBeGreaterThan(0);
      expect(String(warnings[0]![0])).toContain('divergence');

      const after = await fetch(`${baseUrl}/wallets/${wallet.id}`);
      expect((await after.json()).balance).toEqual({ amount: '1000.00', currency: 'BRL' });
    });

    it('returns 404 for an unknown wallet', async () => {
      const res = await reconcile(v4());
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('NOT_FOUND');
    });

    it('reports a negative ledger sum with 200 instead of a 500 (review IM-2)', async () => {
      const wallet = await createWallet('0.00');
      const { MikroORM } = await import('@mikro-orm/core');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (globalThis as any).__walletsApp;
      const orm = app.get(MikroORM);
      const repo = new MikroOrmWalletLedgerEntryRepository(orm.em.fork());
      const zero = Money.fromInternal('0.00', 'BRL');
      const ten = Money.fromInternal('10.00', 'BRL');
      await repo.save(
        WalletLedgerEntry.create({
          walletId: wallet.id,
          transactionId: v4(),
          direction: LedgerDirection.Debit,
          money: ten,
          balanceBefore: zero,
          balanceAfter: zero.subtract(ten), // -10.00: corrupt for a wallet, legal arithmetic
          createdAt: new Date(),
        }),
      );

      const res = await reconcile(wallet.id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consistent).toBe(false);
      expect(body.calculatedBalance).toEqual({ amount: '-10.00', currency: 'BRL' });
      expect(body.difference).toEqual({ amount: '10.00', currency: 'BRL' });
      expect(body.checkedEntries).toBe(1);
    });

    it('returns 400 VALIDATION_ERROR for a malformed walletId', async () => {
      const res = await reconcile('not-a-uuid');
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });
  });
});
