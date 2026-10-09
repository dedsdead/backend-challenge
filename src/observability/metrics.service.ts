import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus registry for the wagering processor (plan T046).
 * Own registry (not the prom-client default) so tests can assert on a
 * controlled set of instruments and never collide with other suites.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/**
 * Wraps a label-less prom-client Counter and keeps a synchronous `.count`
 * for callers that read counters directly (test AC-17 assertions in
 * `tests/integration/wallets.http.spec.ts`).
 */
class CountedCounter {
  private value = 0;

  constructor(
    private readonly counter: Counter<string>,
    private readonly labels?: Record<string, string>,
  ) {}

  inc(): void {
    this.value += 1;
    if (this.labels) {
      this.counter.inc(this.labels);
    } else {
      this.counter.inc();
    }
  }

  get count(): number {
    return this.value;
  }
}

class StatsHistogram {
  private _count = 0;
  private _sum = 0;
  private _min = Infinity;
  private _max = -Infinity;
  private _mean = 0;
  private _m2 = 0;

  constructor(private readonly histogram: Histogram<string>) {}

  observe(value: number): void {
    this.histogram.observe(value);
    this._count++;
    this._sum += value;
    this._min = Math.min(this._min, value);
    this._max = Math.max(this._max, value);
    const delta = value - this._mean;
    this._mean += delta / this._count;
    this._m2 += delta * (value - this._mean);
  }

  get count(): number {
    return this._count;
  }

  get sum(): number {
    return this._sum;
  }

  get avg(): number {
    return this._mean;
  }

  get min(): number {
    return this._min === Infinity ? 0 : this._min;
  }

  get max(): number {
    return this._max === -Infinity ? 0 : this._max;
  }

  get variance(): number {
    return this._count > 1 ? this._m2 / (this._count - 1) : 0;
  }

  get stdDev(): number {
    return Math.sqrt(this.variance);
  }
}

class LagGauge {
  private value = 0;

  constructor(private readonly gauge: Gauge<string>) {}

  set(value: number): void {
    this.value = value;
    this.gauge.set(value);
  }

  get count(): number {
    return this.value;
  }
}

const txStatusCounter = new Counter<string>({
  name: 'wagering_tx_total',
  help: 'Wager transactions processed, by outcome status',
  labelNames: ['status'],
  registers: [registry],
});

const createCounter = (name: string, help: string): Counter<string> =>
  new Counter<string>({ name, help, registers: [registry] });

/**
 * Instrument set required by plan T046 / README §12. Shape is kept from the
 * Phase 5 stub (`src/common/metrics/metrics.ts`) so existing call sites in the
 * use case, consumer and reconciliation service keep working unchanged.
 */
export const metrics = {
  reconciliationDivergence: new CountedCounter(
    createCounter(
      'wagering_reconciliation_divergences_total',
      'Reconciliation divergences detected between stored and recomputed balance',
    ),
  ),
  wageringLockConflictsTotal: new CountedCounter(
    createCounter(
      'wagering_lock_conflicts_total',
      'Wallet row lock waits that exceeded the conflict threshold',
    ),
  ),
  wageringTxTotal: {
    processed: new CountedCounter(txStatusCounter, { status: 'processed' }),
    rejected: new CountedCounter(txStatusCounter, { status: 'rejected' }),
    pendingReference: new CountedCounter(txStatusCounter, {
      status: 'pendingReference',
    }),
  },
  wageringProcessingSeconds: new StatsHistogram(
    new Histogram<string>({
      name: 'wagering_processing_seconds',
      help: 'End-to-end submit-transaction processing time in seconds',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
  ),
  wageringDuplicatesTotal: new CountedCounter(
    createCounter(
      'wagering_duplicates_total',
      'Duplicate submissions replayed from inbox or idempotency storage',
    ),
  ),
  wageringSqsRetriesTotal: new CountedCounter(
    createCounter(
      'wagering_sqs_retries_total',
      'SQS messages left for visibility-timeout redelivery after transient errors',
    ),
  ),
  wageringDlqReceivedTotal: new CountedCounter(
    createCounter(
      'wagering_dlq_received_total',
      'Messages forwarded to the dead-letter queue',
    ),
  ),
  wageringOutboxLag: new LagGauge(
    new Gauge<string>({
      name: 'wagering_outbox_lag',
      help: 'Age in seconds of the oldest unpublished outbox message',
      registers: [registry],
    }),
  ),
};

/**
 * Serves `GET /metrics` (plan T046). Registered as a controller elsewhere so
 * the counter taxonomy above stays importable without Nest DI.
 */
@Injectable()
export class MetricsService {
  get contentType(): string {
    return registry.contentType;
  }

  async render(): Promise<string> {
    return registry.metrics();
  }
}
