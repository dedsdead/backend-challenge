import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

// Same constraint as bootstrap.spec.ts: env defaults must run before any
// module evaluation that triggers AppModule (ConfigModule validates at import).
process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_ENDPOINT ??= 'http://localhost:4566';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';
process.env.LOG_LEVEL ??= 'silent';
process.env.WORKERS_ENABLED ??= 'false';

type MetricsFacade = typeof import('../../src/common/metrics/metrics').metrics;

describe('GET /metrics (plan T046)', () => {
  let app: INestApplication | undefined;
  let baseUrl = '';
  let metrics: MetricsFacade;

  beforeAll(async () => {
    await acquireTestLock();
    try {
      const { NestFactory } = await import('@nestjs/core');
      const { AppModule } = await import('../../src/app.module');
      app = await NestFactory.create(AppModule, { logger: false });
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') {
        throw new Error('expected a TCP AddressInfo from listen(0)');
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      metrics = (await import('../../src/common/metrics/metrics')).metrics;
    } catch (error) {
      await app?.close();
      await releaseTestLock();
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await releaseTestLock();
  }, 60_000);

  it('exposes the endpoint with public-style 200 text/plain (no token needed yet)', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/plain');

    const body = await res.text();
    for (const metric of [
      'wagering_tx_total',
      'wagering_duplicates_total',
      'wagering_sqs_retries_total',
      'wagering_dlq_received_total',
      'wagering_reconciliation_divergences_total',
      'wagering_lock_conflicts_total',
      'wagering_outbox_lag',
      'wagering_processing_seconds',
    ]) {
      expect(body).toContain(metric);
    }
  });

  it('reflects facade increments in the rendered registry', async () => {
    const before = metrics.wageringDuplicatesTotal.count;
    metrics.wageringDuplicatesTotal.inc();

    const body = await (await fetch(`${baseUrl}/metrics`)).text();
    const match = body.match(/^wagering_duplicates_total (\d+(?:\.\d+)?)/m);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(before + 1);
  });

  it('renders the status-labelled transaction counter', async () => {
    metrics.wageringTxTotal.processed.inc();
    const body = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(body).toMatch(/wagering_tx_total\{status="processed"\} \d+/);
  });
});
