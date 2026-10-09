import { describe, expect, it } from 'bun:test';
import { metrics, registry } from '../../../src/observability/metrics.service';

describe('metrics service (plan T046)', () => {
  it('exposes every plan metric name through the prometheus registry', async () => {
    const txBefore = await registry.getSingleMetric('wagering_tx_total');
    expect(txBefore).not.toBeNull();

    metrics.wageringTxTotal.processed.inc();
    const dupBefore = metrics.wageringDuplicatesTotal.count;
    metrics.wageringDuplicatesTotal.inc();
    const retryBefore = metrics.wageringSqsRetriesTotal.count;
    metrics.wageringSqsRetriesTotal.inc();
    const dlqBefore = metrics.wageringDlqReceivedTotal.count;
    metrics.wageringDlqReceivedTotal.inc();
    const divBefore = metrics.reconciliationDivergence.count;
    metrics.reconciliationDivergence.inc();
    const lockBefore = metrics.wageringLockConflictsTotal.count;
    metrics.wageringLockConflictsTotal.inc();
    metrics.wageringOutboxLag.set(42);
    metrics.wageringProcessingSeconds.observe(0.25);

    const text = await registry.metrics();
    expect(text).toContain('wagering_tx_total{status="processed"} 1');
    expect(text).toContain('wagering_duplicates_total ');
    expect(text).toContain('wagering_sqs_retries_total ');
    expect(text).toContain('wagering_dlq_received_total ');
    expect(text).toContain('wagering_reconciliation_divergences_total ');
    expect(text).toContain('wagering_lock_conflicts_total ');
    expect(text).toContain('wagering_outbox_lag 42');
    expect(text).toContain('wagering_processing_seconds_bucket');

    expect(metrics.wageringDuplicatesTotal.count).toBe(dupBefore + 1);
    expect(metrics.wageringSqsRetriesTotal.count).toBe(retryBefore + 1);
    expect(metrics.wageringDlqReceivedTotal.count).toBe(dlqBefore + 1);
    expect(metrics.reconciliationDivergence.count).toBe(divBefore + 1);
    expect(metrics.wageringLockConflictsTotal.count).toBe(lockBefore + 1);
  });

  it('tracks transaction status labels and keeps sync .count accessors', () => {
    const processedBefore = metrics.wageringTxTotal.processed.count;
    const rejectedBefore = metrics.wageringTxTotal.rejected.count;
    const pendingBefore = metrics.wageringTxTotal.pendingReference.count;

    metrics.wageringTxTotal.processed.inc();
    metrics.wageringTxTotal.rejected.inc();
    metrics.wageringTxTotal.pendingReference.inc();

    expect(metrics.wageringTxTotal.processed.count).toBe(processedBefore + 1);
    expect(metrics.wageringTxTotal.rejected.count).toBe(rejectedBefore + 1);
    expect(metrics.wageringTxTotal.pendingReference.count).toBe(pendingBefore + 1);
  });

  it('observes processing durations into the histogram', () => {
    const before = metrics.wageringProcessingSeconds.count;
    metrics.wageringProcessingSeconds.observe(0.5);
    expect(metrics.wageringProcessingSeconds.count).toBe(before + 1);
    expect(metrics.wageringProcessingSeconds.sum).toBeGreaterThan(0);
  });
});
