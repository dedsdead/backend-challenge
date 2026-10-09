import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { v4 } from 'uuid';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';
import { bearer } from '../helpers/keycloak-token';

// T029 — end-to-end acceptance walk over spec §9 endpoints against real PG.
// Requests carry a real Keycloak token (T044/T048); 401/403 behavior is
// covered by auth-observability.spec.

process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';

interface WalletBody {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
}

describe('HTTP API end-to-end (T029)', () => {
  let baseUrl = '';
  let truncate: () => Promise<void> = async () => {};
  let auth: Record<string, string> = {};

  const authedFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    globalThis.fetch(input, {
      ...init,
      headers: { ...((init?.headers ?? {}) as Record<string, string>), ...auth },
    });

  beforeAll(async () => {
    auth = await bearer('operator');
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
    const { WalletEntity } = await import('../../src/database/entities/wallet.entity');
    const { WagerTransactionEntity } = await import(
      '../../src/database/entities/wager-transaction.entity'
    );
    const { InboxMessageEntity } = await import(
      '../../src/database/entities/inbox-message.entity'
    );
    const { OutboxMessageEntity } = await import(
      '../../src/database/entities/outbox-message.entity'
    );
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
    (globalThis as any).__httpApiApp = app;
  }, 20_000);

  afterAll(async () => {
    await truncate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (globalThis as any).__httpApiApp;
    await app?.close();
    await releaseTestLock();
  }, 20_000);

  const createWallet = async (amount = '1000.00', currency = 'BRL'): Promise<WalletBody> => {
    const res = await authedFetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: v4(),
        initialBalance: { amount, currency },
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as WalletBody;
  };

  const submitBody = (
    wallet: WalletBody,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    providerId: 'prov-1',
    externalTransactionId: `ext-${v4()}`,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: v4(),
    gameId: v4(),
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  });

  const post = (body: Record<string, unknown>, idempotencyKey?: string) =>
    authedFetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey ?? `idem-${v4()}`,
      },
      body: JSON.stringify(body),
    });

  const getWallet = async (walletId: string): Promise<WalletBody> => {
    const res = await authedFetch(`${baseUrl}/wallets/${walletId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as WalletBody;
  };

  const getLedger = async (walletId: string, query = '') => {
    const res = await authedFetch(`${baseUrl}/wallets/${walletId}/ledger${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      entries: { id: string; direction: string; amount: string }[];
      nextCursor: string | null;
    };
  };

  it('walks the wallet lifecycle: create (version 1), duplicate 409, second currency 201 (AC-1/AC-2/G18)', async () => {
    const playerId = v4();
    const first = await authedFetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } }),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as WalletBody;
    expect(created.version).toBe(1);
    expect(created.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

    const dup = await authedFetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } }),
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe('WALLET_EXISTS');

    const usd = await authedFetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '5.00', currency: 'USD' } }),
    });
    expect(usd.status).toBe(201);

    const fetched = await getWallet(created.id);
    expect(Object.keys(fetched).sort()).toEqual(['balance', 'id', 'playerId', 'version']);
    expect(fetched.version).toBe(1);
  });

  it('processes BET/WIN/LOSS with correct balances and ledger directions', async () => {
    const wallet = await createWallet('1000.00');

    const bet = await (await post(submitBody(wallet, { money: { amount: '100.00', currency: 'BRL' } }))).json();
    expect(bet.status).toBe('PROCESSED');
    expect(bet.balance).toEqual({ amount: '900.00', currency: 'BRL' });

    const win = await (
      await post(submitBody(wallet, { kind: 'WIN', money: { amount: '50.00', currency: 'BRL' } }))
    ).json();
    expect(win.status).toBe('PROCESSED');
    expect(win.balance).toEqual({ amount: '950.00', currency: 'BRL' });

    const loss = await (
      await post(submitBody(wallet, { kind: 'LOSS', money: { amount: '25.00', currency: 'BRL' } }))
    ).json();
    expect(loss.status).toBe('PROCESSED');
    expect(loss.balance).toEqual({ amount: '950.00', currency: 'BRL' });

    const ledger = await getLedger(wallet.id);
    const byType: Record<string, number> = {};
    for (const entry of ledger.entries) {
      const key = `${entry.direction}:${entry.amount}`;
      byType[key] = (byType[key] ?? 0) + 1;
    }
    expect(byType['DEBIT:100.00']).toBe(1);
    expect(byType['CREDIT:50.00']).toBe(1);
    expect(ledger.entries).toHaveLength(3); // opening + bet + win (LOSS writes no entry)
  });

  it('rejects insufficient funds without touching balance or ledger', async () => {
    const wallet = await createWallet('100.00');
    const res = await post(submitBody(wallet, { money: { amount: '500.00', currency: 'BRL' } }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(body.status).toBe('REJECTED');

    expect((await getWallet(wallet.id)).balance).toEqual({ amount: '100.00', currency: 'BRL' });
    const ledger = await getLedger(wallet.id);
    expect(ledger.entries).toHaveLength(1); // opening only
  });

  it('replays with the original balance and 409s a conflicting payload (plan T029 / AC-5)', async () => {
    const wallet = await createWallet('1000.00');
    const body = submitBody(wallet, { money: { amount: '100.00', currency: 'BRL' } });
    const key = `idem-${v4()}`;

    const first = await (await post(body, key)).json();
    expect(first.status).toBe('PROCESSED');
    expect(first.balance).toEqual({ amount: '900.00', currency: 'BRL' });

    const replay = await (await post(body, key)).json();
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance).toEqual({ amount: '900.00', currency: 'BRL' });

    const conflict = await post(
      { ...body, externalTransactionId: `ext-${v4()}`, money: { amount: '200.00', currency: 'BRL' } },
      key,
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await getWallet(wallet.id)).balance).toEqual({ amount: '900.00', currency: 'BRL' });
  });

  it('refunds once, rejects the second refund, and allows mixed-type rollback (plan T029)', async () => {
    const wallet = await createWallet('1000.00');
    const betBody = submitBody(wallet, { money: { amount: '100.00', currency: 'BRL' } });
    const bet = await (await post(betBody)).json();
    expect(bet.status).toBe('PROCESSED');
    expect(bet.balance).toEqual({ amount: '900.00', currency: 'BRL' });

    const reference = betBody['externalTransactionId'];
    const roundId = betBody['roundId'];
    const refund1 = await (
      await post(
        submitBody(wallet, {
          kind: 'REFUND',
          roundId,
          referenceExternalTransactionId: reference,
          money: { amount: '100.00', currency: 'BRL' },
        }),
      )
    ).json();
    expect(refund1.status).toBe('PROCESSED');
    expect(refund1.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

    const refund2Res = await post(
      submitBody(wallet, {
        kind: 'REFUND',
        roundId,
        referenceExternalTransactionId: reference,
        money: { amount: '100.00', currency: 'BRL' },
      }),
    );
    expect(refund2Res.status).toBe(422);
    const refund2 = await refund2Res.json();
    expect(refund2.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
    expect(refund2.status).toBe('REJECTED');

    const rollback = await (
      await post(
        submitBody(wallet, {
          kind: 'ROLLBACK',
          roundId,
          referenceExternalTransactionId: reference,
          money: { amount: '100.00', currency: 'BRL' },
        }),
      )
    ).json();
    expect(rollback.status).toBe('PROCESSED');
    expect(rollback.balance).toEqual({ amount: '1100.00', currency: 'BRL' });

    const rollback2Res = await post(
      submitBody(wallet, {
        kind: 'ROLLBACK',
        roundId,
        referenceExternalTransactionId: reference,
        money: { amount: '100.00', currency: 'BRL' },
      }),
    );
    expect(rollback2Res.status).toBe(422);
    expect((await rollback2Res.json()).failureCode).toBe('REFERENCE_ALREADY_REVERSED');
    expect((await getWallet(wallet.id)).balance).toEqual({ amount: '1100.00', currency: 'BRL' });
  });

  it('rejects a cross-currency submit with 422 CURRENCY_MISMATCH and no effects (plan T029)', async () => {
    const brl = await createWallet('1000.00', 'BRL');
    const usd = await createWallet('500.00', 'USD');

    const res = await post(
      submitBody(brl, { money: { amount: '25.00', currency: 'USD' } }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.failureCode).toBe('CURRENCY_MISMATCH');

    // review CR-2: the stored snapshot keeps the WALLET currency — a read-back
    // must not rebuild it from the transaction currency (USD here).
    const read = await authedFetch(`${baseUrl}/wagering/transactions/${body.transactionId as string}`);
    expect(read.status).toBe(200);
    const found = await read.json();
    expect(found.status).toBe('REJECTED');
    expect(found.failureCode).toBe('CURRENCY_MISMATCH');
    expect(found.balance).toEqual({ amount: '1000.00', currency: 'BRL' });

    expect((await getWallet(brl.id)).balance).toEqual({ amount: '1000.00', currency: 'BRL' });
    const ledger = await getLedger(brl.id);
    expect(ledger.entries).toHaveLength(1); // opening only
    expect((await getWallet(usd.id)).balance).toEqual({ amount: '500.00', currency: 'USD' });
  });

  it('rejects OPENING externally (AC-18) and reports reconciliation consistent (AC-17/AC-17b)', async () => {
    const wallet = await createWallet('1000.00');
    const opening = await post(submitBody(wallet, { kind: 'OPENING' }));
    expect(opening.status).toBe(400);
    expect((await opening.json()).code).toBe('VALIDATION_ERROR');

    const rec = await authedFetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, { method: 'POST' });
    expect(rec.status).toBe(200);
    expect(await rec.json()).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '1000.00', currency: 'BRL' },
      calculatedBalance: { amount: '1000.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });

    const empty = await createWallet('0.00');
    const emptyRec = await authedFetch(`${baseUrl}/wallets/${empty.id}/reconciliation`, {
      method: 'POST',
    });
    const emptyBody = await emptyRec.json();
    expect(emptyBody.consistent).toBe(true);
    expect(emptyBody.checkedEntries).toBe(0);
    expect(emptyBody.difference).toEqual({ amount: '0.00', currency: 'BRL' });
  });

  it('walks the ledger with limit=1 without duplicates or skips (AC-21)', async () => {
    const wallet = await createWallet('1000.00');
    for (const amount of ['10.00', '20.00', '30.00']) {
      const res = await post(submitBody(wallet, { money: { amount, currency: 'BRL' } }));
      expect(res.status).toBe(200);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await getLedger(wallet.id, query);
      expect(page.entries.length).toBeLessThanOrEqual(1);
      seen.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen).toHaveLength(4); // opening + 3 bets
    expect(new Set(seen).size).toBe(4);

    const full = await getLedger(wallet.id);
    expect(full.entries.map((e) => e.id)).toEqual(seen); // newest-first match
  });
});
