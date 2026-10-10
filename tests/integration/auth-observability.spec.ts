import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { v4 } from 'uuid';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';
import { bearer, keycloakToken } from '../helpers/keycloak-token';

// T044/T048 — authentication, authorization and log hygiene against the real
// Keycloak realm from keycloak/realm-export.json (users verified in T043).

process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';
process.env.WORKERS_ENABLED = 'false';

/** In-memory pino destination: captures every JSON log line the app emits. */
class LogSink {
  chunks: string[] = [];
  write(chunk: unknown): void {
    this.chunks.push(String(chunk));
  }
  lines(): string[] {
    return this.chunks
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0);
  }
}

const anyWalletId = '00000000-0000-4000-8000-000000000000';

describe('auth & observability (T044/T048)', () => {
  let baseUrl = '';
  let sink: LogSink | undefined;

  beforeAll(async () => {
    await acquireTestLock();
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../../src/app.module');
    const { PinoLoggerService } = await import('../../src/observability/logger');
    sink = new LogSink();
    const app = await NestFactory.create(AppModule, {
      logger: new PinoLoggerService({ destination: sink, level: 'info' }),
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP AddressInfo from listen(0)');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__authObsApp = app;
  }, 20_000);

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (globalThis as any).__authObsApp;
    await app?.close();
    await releaseTestLock();
  }, 20_000);

  const authed = async (
    path: string,
    user: string,
    init: RequestInit = {},
  ): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(await bearer(user)) },
    });

  describe('public routes stay reachable without a token', () => {
    it('GET /health/live returns 200', async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('ok');
    });

    it('GET /metrics returns Prometheus text without auth', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('wagering_');
    });
  });

  describe('401 without or with an invalid token (UNAUTHORIZED)', () => {
    it('rejects a tokenless POST /wallets', async () => {
      const res = await fetch(`${baseUrl}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: v4(),
          initialBalance: { amount: '10.00', currency: 'BRL' },
        }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects a tokenless GET', async () => {
      const res = await fetch(`${baseUrl}/wallets/${anyWalletId}`);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    });

    it('rejects a non-Bearer Authorization header', async () => {
      const res = await fetch(`${baseUrl}/wallets/${anyWalletId}`, {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    });

    it('rejects a garbage bearer token', async () => {
      const res = await fetch(`${baseUrl}/wallets/${anyWalletId}`, {
        headers: { authorization: 'Bearer not-a-jwt' },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    });

    it('rejects a real token whose signature was tampered with', async () => {
      const token = await keycloakToken('operator');
      const tampered = `${token.slice(0, -4)}${token.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
      const res = await fetch(`${baseUrl}/wallets/${anyWalletId}`, {
        headers: { authorization: `Bearer ${tampered}` },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    });
  });

  describe('403 on role mismatch (ROLE_FORBIDDEN)', () => {
    it('read-only-client cannot POST /wallets', async () => {
      const res = await authed('/wallets', 'read-only-client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: v4(),
          initialBalance: { amount: '10.00', currency: 'BRL' },
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ROLE_FORBIDDEN');
    });

    it('read-only-client cannot POST /wagering/transactions', async () => {
      const res = await authed('/wagering/transactions', 'read-only-client', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-authobs-1' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('ROLE_FORBIDDEN');
    });

    it('write-only-client cannot GET /wallets/:walletId', async () => {
      const res = await authed(`/wallets/${anyWalletId}`, 'write-only-client');
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('ROLE_FORBIDDEN');
    });

    it('write-only-client cannot GET /wallets/:walletId/ledger', async () => {
      const res = await authed(`/wallets/${anyWalletId}/ledger`, 'write-only-client');
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('ROLE_FORBIDDEN');
    });
  });

  describe('both directions: correct roles get through', () => {
    it('operator (read+write) creates a wallet with 201 and reads it with 200', async () => {
      const created = await authed('/wallets', 'operator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: v4(),
          initialBalance: { amount: '25.00', currency: 'BRL' },
        }),
      });
      expect(created.status).toBe(201);
      const wallet = (await created.json()) as { id: string };

      const read = await authed(`/wallets/${wallet.id}`, 'operator');
      expect(read.status).toBe(200);

      const readOnly = await authed(`/wallets/${wallet.id}`, 'read-only-client');
      expect(readOnly.status).toBe(200);

      const writeOnly = await authed('/wallets', 'write-only-client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: v4(),
          initialBalance: { amount: '5.00', currency: 'BRL' },
        }),
      });
      expect(writeOnly.status).toBe(201);
    });
  });

  describe('JSON logs never carry the authorization header', () => {
    it('warns with cid= for a 400 triggered by an authenticated request, with no bearer token in the log', async () => {
      const token = await keycloakToken('operator');
      const before = sink?.lines().length ?? 0;

      const res = await fetch(`${baseUrl}/wallets/not-a-uuid`, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-correlation-id': 'authobs-cid-1',
        },
      });
      expect(res.status).toBe(400);

      // pino may flush asynchronously; poll for the filter's warn line.
      let lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines = sink?.lines() ?? [];
        if (lines.some((line) => line.includes('cid=authobs-cid-1'))) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const fresh = lines.slice(before);
      expect(fresh.some((line) => line.includes('cid=authobs-cid-1'))).toBe(true);

      const parsed = fresh.map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      });
      // Find the warn line that specifically contains our correlation ID
      const warnLine = parsed.find(
        (entry) => entry && (entry['level'] === 40 || entry['level'] === 'warn') &&
                   String(entry['msg']).includes('cid=authobs-cid-1'),
      );
      expect(warnLine).toBeDefined();
      expect(String(warnLine?.['msg'])).toContain('cid=authobs-cid-1');

      for (const line of fresh) {
        expect(line.toLowerCase()).not.toContain('authorization');
        expect(line).not.toContain('Bearer ');
        expect(line).not.toContain(token);
      }
    });
  });
});
