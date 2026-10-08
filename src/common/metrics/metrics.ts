/**
 * Phase 4 metric stub (plan T025/T033): counters are real Prometheus
 * instruments from Phase 8 (`GET /metrics`); in-memory counting keeps
 * AC-17 assertions possible before that task lands.
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

export const metrics = {
  reconciliationDivergence: new CounterStub(),
};
