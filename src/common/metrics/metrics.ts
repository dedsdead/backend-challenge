/**
 * Phase 4 metric stub (plan T025/T033): counters are real Prometheus
 * instruments from Phase 8 (`GET /metrics`); in-memory counting keeps
 * AC-17 assertions possible before that task lands.
 * 
 * Phase 5 additions (T033): lock-conflict and transaction counters.
 */
class CounterStub {
  private value = 0;

  inc(): void {
    this.value += 1;
  }

  get count(): number {
    return this.value;
  }
}

/**
 * HistogramStub using Welford's online algorithm for streaming statistics.
 * O(1) memory — no unbounded array growth. Suitable for production use
 * until Phase 8 Prometheus instruments replace it.
 */
class HistogramStub {
  private _count = 0;
  private _sum = 0;
  private _min = Infinity;
  private _max = -Infinity;
  private _mean = 0;
  private _m2 = 0; // for variance (Welford's algorithm)

  observe(value: number): void {
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

export const metrics = {
  reconciliationDivergence: new CounterStub(),
  // Phase 5 (T033) - lock conflict and transaction metrics
  wageringLockConflictsTotal: new CounterStub(),
  wageringTxTotal: {
    processed: new CounterStub(),
    rejected: new CounterStub(),
    pendingReference: new CounterStub(),
  },
  wageringProcessingSeconds: new HistogramStub(),
};