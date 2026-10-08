import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { v4 } from 'uuid';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

// T027 (AC-18 HTTP side, AC-19, AC-20/20a, AC-25, AC-28, G4/G5/G12/G14).
// Phase 4 runs without tokens — guards arrive in plan T044 (Phase 8).

process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';

describe('wagering HTTP API (T027)', () => {
  let baseUrl = '';
  let truncate: () => Promise<void> = async () => {};
  let runSql: (sql: string, params?: unknown[]) => Promise<unknown> = async () => [];

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
    runSql = (sql, params) => em.getConnection().execute(sql, params);
    truncate = async () => {
      await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
      await em.nativeDelete(WagerTransactionEntity, {} as never);
      await em.nativeDelete(WalletEntity, {} as never);
      await em.nativeDelete(InboxMessageEntity, {} as never);
      await em.nativeDelete(OutboxMessageEntity, {} as never);
    };
    await truncate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__wageringApp = app;
  }, 20_000);

  afterAll(async () => {
    await truncate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (globalThis as any).__wageringApp;
    await app?.close();
    await releaseTestLock();
  }, 20_000);

  const createWallet = async (amount = '1000.00') => {
    const res = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: v4(),
        initialBalance: { amount, currency: 'BRL' },
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; playerId: string };
  };

  const submitBody = (walletId: string, playerId: string, overrides: Record<string, unknown> = {}) => ({
    providerId: 'prov-1',
    externalTransactionId: `ext-${v4()}`,
    playerId,
    walletId,
    roundId: v4(),
    gameId: v4(),
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  });

  const post = (body: unknown, idempotencyKey?: string | null) =>
    fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(idempotencyKey === null
          ? {}
          : { 'idempotency-key': idempotencyKey ?? `idem-${v4()}` }),
      },
      body: JSON.stringify(body),
    });

  describe('POST /wagering/transactions', () => {
    it('processes a BET with 200 and the §9 response body', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual([
        'balance',
        'idempotentReplay',
        'status',
        'transactionId',
      ]);
      expect(body.status).toBe('PROCESSED');
      expect(body.idempotentReplay).toBe(false);
      expect(body.balance).toEqual({ amount: '975.00', currency: 'BRL' });
      expect(typeof body.transactionId).toBe('string');
    });

    it('rejects a missing Idempotency-Key with 400 and writes nothing (AC-19)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId), null);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.transactionId).toBeUndefined();
      expect(body.errors?.[0]?.property).toBe('idempotency-key');

      const rows = (await runSql(
        'SELECT COUNT(*)::int AS n FROM wager_transaction WHERE wallet_id = ?',
        [wallet.id],
      )) as { n: number }[];
      expect(rows[0]!.n).toBe(1); // opening only
    });

    it('rejects an empty or whitespace-only Idempotency-Key with 400 (AC-19)', async () => {
      const wallet = await createWallet('1000.00');
      for (const key of ['', '   ']) {
        const res = await post(submitBody(wallet.id, wallet.playerId), key);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.transactionId).toBeUndefined();
      }
    });

    it('rejects kind OPENING with 400 VALIDATION_ERROR (AC-18 HTTP side)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId, { kind: 'OPENING' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors?.[0]?.property).toBe('kind');
      expect(body.transactionId).toBeUndefined();
    });

    it('aggregates every invalid field in errors[] (AC-24)', async () => {
      const res = await post({
        providerId: 'prov-1',
        externalTransactionId: `ext-${v4()}`,
        playerId: 'not-a-uuid',
        walletId: 'also-not-a-uuid',
        roundId: v4(),
        gameId: v4(),
        kind: 'BET',
        money: { amount: '10', currency: 'brl' },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const properties = body.errors.map((e: { property: string }) => e.property);
      expect(properties).toContain('playerId');
      expect(properties).toContain('walletId');
      expect(properties).toContain('money.amount');
      expect(properties).toContain('money.currency');
      for (const error of body.errors) {
        expect(Object.keys(error.constraints).length).toBeGreaterThan(0);
      }
      expect(typeof body.message).toBe('string');
    });

    it('rejects a payload without money with 400, not a 500 (review CR-1)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId, { money: undefined }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'money');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
      expect(body.transactionId).toBeUndefined();
    });

    it('rejects money as an empty array with 400, not a 500', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId, { money: [] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'money');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
      expect(body.transactionId).toBeUndefined();
    });

    it('rejects money as an array of objects with 400, not a 500', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId, { money: [{}] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      const entry = body.errors.find((e: { property: string }) => e.property === 'money');
      expect(entry).toBeDefined();
      expect(Object.keys(entry.constraints).length).toBeGreaterThan(0);
      expect(body.transactionId).toBeUndefined();
    });

    it('requires referenceExternalTransactionId for REFUND/ROLLBACK with 400 (review CR-1)', async () => {
      const wallet = await createWallet('1000.00');
      for (const kind of ['REFUND', 'ROLLBACK']) {
        const res = await post(submitBody(wallet.id, wallet.playerId, { kind }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('VALIDATION_ERROR');
        const properties = body.errors.map((e: { property: string }) => e.property);
        expect(properties).toContain('referenceExternalTransactionId');
        expect(body.transactionId).toBeUndefined();
      }
    });

    it('rejects ids longer than 255 characters with 400 (review IM-6)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(
        submitBody(wallet.id, wallet.playerId, { providerId: 'p'.repeat(300) }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors.map((e: { property: string }) => e.property)).toContain('providerId');
    });

    it('rejects an Idempotency-Key containing a comma with 400 (review CR-6)', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post(submitBody(wallet.id, wallet.playerId), 'keyA-1, keyB-2');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors?.[0]?.property).toBe('idempotency-key');
    });

    it('returns 409 for the same external id under a different Idempotency-Key (review CR-5)', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId);
      const first = await post(body, `idem-${v4()}`);
      expect(first.status).toBe(200);

      const other = await post(body, `idem-${v4()}`);
      expect(other.status).toBe(409);
      const conflict = await other.json();
      expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.statusCode).toBe(409);

      const rows = (await runSql(
        'SELECT COUNT(*)::int AS n FROM wager_transaction WHERE wallet_id = ? AND kind = ?',
        [wallet.id, 'BET'],
      )) as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });

    it('rejects unknown payload fields with 400', async () => {
      const wallet = await createWallet('1000.00');
      const res = await post({ ...submitBody(wallet.id, wallet.playerId), admin: true });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });

    it('maps a business rejection to 422 with the pinned body and no balance (G14, AC-5a)', async () => {
      const wallet = await createWallet('100.00');
      const res = await post(submitBody(wallet.id, wallet.playerId, { money: { amount: '500.00', currency: 'BRL' } }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual([
        'code',
        'failureCode',
        'idempotentReplay',
        'message',
        'status',
        'statusCode',
        'transactionId',
      ]);
      expect(body.code).toBe('TRANSACTION_REJECTED');
      expect(body.status).toBe('REJECTED');
      expect(body.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(body.idempotentReplay).toBe(false);
      expect(typeof body.transactionId).toBe('string');
    });

    it('replays a stored success with idempotentReplay: true and no new effects', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId);
      const key = `idem-${v4()}`;
      const first = await post(body, key);
      expect(first.status).toBe(200);
      const second = await post(body, key);
      expect(second.status).toBe(200);
      const replay = await second.json();
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transactionId).toBe((await first.json()).transactionId);
      expect(replay.balance).toEqual({ amount: '975.00', currency: 'BRL' });
    });

    it('returns 409 IDEMPOTENCY_CONFLICT for a reused key with a different payload', async () => {
      const wallet = await createWallet('1000.00');
      const key = `idem-${v4()}`;
      const first = await post(submitBody(wallet.id, wallet.playerId), key);
      expect(first.status).toBe(200);
      const conflict = await post(
        submitBody(wallet.id, wallet.playerId, { money: { amount: '30.00', currency: 'BRL' } }),
        key,
      );
      expect(conflict.status).toBe(409);
      const body = await conflict.json();
      expect(body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(body.failureCode).toBeUndefined();
    });

    it('replays a stored rejection as the identical 422 with idempotentReplay: true (AC-5a)', async () => {
      const wallet = await createWallet('100.00');
      const body = submitBody(wallet.id, wallet.playerId, { money: { amount: '500.00', currency: 'BRL' } });
      const key = `idem-${v4()}`;
      const first = await post(body, key);
      expect(first.status).toBe(422);
      const original = await first.json();
      const second = await post(body, key);
      expect(second.status).toBe(422);
      const replay = await second.json();
      expect(replay).toEqual({ ...original, idempotentReplay: true });
    });

    it('accepts a pending reference with 202 (no balance) and replays it (AC-25, G5)', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId, {
        kind: 'REFUND',
        referenceExternalTransactionId: `missing-${v4()}`,
      });
      const key = `idem-${v4()}`;
      const first = await post(body, key);
      expect(first.status).toBe(202);
      const accepted = await first.json();
      expect(Object.keys(accepted).sort()).toEqual([
        'idempotentReplay',
        'status',
        'transactionId',
      ]);
      expect(accepted.status).toBe('PENDING_REFERENCE');
      expect(accepted.idempotentReplay).toBe(false);

      const second = await post(body, key);
      expect(second.status).toBe(202);
      const replay = await second.json();
      expect(replay).toEqual({ ...accepted, idempotentReplay: true });
    });
  });

  describe('GET lookups (AC-28)', () => {
    it('returns the pinned body for a PROCESSED transaction', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId);
      const submitted = await (await post(body)).json();
      const res = await fetch(`${baseUrl}/wagering/transactions/${submitted.transactionId}`);
      expect(res.status).toBe(200);
      const found = await res.json();
      expect(Object.keys(found).sort()).toEqual([
        'balance',
        'externalTransactionId',
        'kind',
        'status',
        'transactionId',
      ]);
      expect(found.transactionId).toBe(submitted.transactionId);
      expect(found.externalTransactionId).toBe(body.externalTransactionId);
      expect(found.kind).toBe('BET');
      expect(found.status).toBe('PROCESSED');
      expect(found.balance).toEqual({ amount: '975.00', currency: 'BRL' });
      expect(found.failureCode).toBeUndefined();
    });

    it('returns failureCode and balance for a REJECTED transaction', async () => {
      const wallet = await createWallet('100.00');
      const body = submitBody(wallet.id, wallet.playerId, { money: { amount: '500.00', currency: 'BRL' } });
      const submitted = await (await post(body)).json();
      const res = await fetch(`${baseUrl}/wagering/transactions/${submitted.transactionId}`);
      expect(res.status).toBe(200);
      const found = await res.json();
      expect(Object.keys(found).sort()).toEqual([
        'balance',
        'externalTransactionId',
        'failureCode',
        'kind',
        'status',
        'transactionId',
      ]);
      expect(found.status).toBe('REJECTED');
      expect(found.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(found.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    });

    it('polls a PENDING_REFERENCE without balance (AC-25/AC-28)', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId, {
        kind: 'REFUND',
        referenceExternalTransactionId: `missing-${v4()}`,
      });
      const submitted = await (await post(body)).json();
      const res = await fetch(`${baseUrl}/wagering/transactions/${submitted.transactionId}`);
      expect(res.status).toBe(200);
      const found = await res.json();
      expect(Object.keys(found).sort()).toEqual([
        'externalTransactionId',
        'kind',
        'status',
        'transactionId',
      ]);
      expect(found.status).toBe('PENDING_REFERENCE');
      expect(found.balance).toBeUndefined();
      expect(found.failureCode).toBeUndefined();
    });

    it('404s an unknown transactionId and 400s a malformed one (AC-20/20a)', async () => {
      const unknown = await fetch(`${baseUrl}/wagering/transactions/${v4()}`);
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).code).toBe('NOT_FOUND');

      const malformed = await fetch(`${baseUrl}/wagering/transactions/not-a-uuid`);
      expect(malformed.status).toBe(400);
      expect((await malformed.json()).code).toBe('VALIDATION_ERROR');
    });

    it('resolves the provider-scoped lookup and 404s a foreign provider (AC-20)', async () => {
      const wallet = await createWallet('1000.00');
      const body = submitBody(wallet.id, wallet.playerId);
      const submitted = await (await post(body)).json();

      const ok = await fetch(
        `${baseUrl}/providers/prov-1/wagering/transactions/${body.externalTransactionId}`,
      );
      expect(ok.status).toBe(200);
      const found = await ok.json();
      expect(found.transactionId).toBe(submitted.transactionId);
      expect(Object.keys(found).sort()).toEqual([
        'balance',
        'externalTransactionId',
        'kind',
        'status',
        'transactionId',
      ]);

      const foreign = await fetch(
        `${baseUrl}/providers/other-prov/wagering/transactions/${body.externalTransactionId}`,
      );
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).code).toBe('NOT_FOUND');

      const unknownExternal = await fetch(
        `${baseUrl}/providers/prov-1/wagering/transactions/nope-123`,
      );
      expect(unknownExternal.status).toBe(404);
    });
  });
});
