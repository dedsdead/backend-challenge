/**
 * Facade kept for existing call sites (plan T025/T033): the real Prometheus
 * instruments live in `src/observability/metrics.service.ts` (plan T046) and
 * are served by `GET /metrics`. Re-exported here so the use case,
 * reconciliation service and tests import a stable path.
 */
export { metrics } from '../../observability/metrics.service';
