# Observability Requirement Quality Checklist

Plan: `docs/plans/20261006111327-full-wagering-processor-plan.md`
Domain: observability

- [ ] CHK001 Are health endpoints specified with distinct semantics: liveness (process) vs readiness (PostgreSQL + SQS) and their status codes? [Clarity]
- [ ] CHK002 Is the metrics inventory complete and named (`wagering_tx_total{status}`, duplicates, sqs retries, DLQ, divergences, lock conflicts, outbox lag gauge, processing histogram)? [Completeness]
- [ ] CHK003 Is each metric specified with its instrument type (counter/gauge/histogram), labels, and the code location that increments it? [Measurability]
- [ ] CHK004 Is structured logging specified: fields (correlationId, transactionId, walletId, providerId, messageId), format (pino), and level conventions? [Completeness]
- [ ] CHK005 Is correlation-ID propagation specified end-to-end (inbound header honored, generated otherwise, response header, log binding)? [Scenario coverage]
- [ ] CHK006 Are log redaction requirements specified (authorization header, payload/data/body paths) with a testable assertion? [Measurability]
- [ ] CHK007 Is outbox lag defined precisely (oldest unpublished age in seconds) so the gauge is reproducible? [Clarity]
- [ ] CHK008 Are failure-mode observability requirements specified: divergence logged+counted (never auto-corrected), DLQ receive counted, permanent vs transient consumer failures logged distinctly? [Coverage]
- [ ] CHK009 Is worker/consumer observability specified (messageId binding, retry logging, SIGTERM drain logging)? [Completeness]
- [ ] CHK010 Are readiness failure requirements specified: which dependency failure yields 503 and that app stays healthy on DLQ/poison messages (AC-14)? [Edge Case]
- [ ] CHK011 Is `/metrics` exposure specified as `@Public()` with its rationale (scrape without token)? [Consistency]
- [ ] CHK012 Are assumptions stated (prom-client in-process scraping, no external APM) so evaluators know the observability boundary? [Dependencies and assumptions]
- [ ] CHK013 Are the brainstorm log fields (correlationId, messageId, transactionId, walletId, providerId) carried as individually checkable requirements? [Measurability]
- [ ] CHK014 Is the "no full financial payloads in logs" brainstorm constraint specified with a verifiable assertion? [Completeness]
- [ ] CHK015 Is the readiness dependency set explicitly decided (source: plan T047 / clarifications) rather than left implicit? [Edge Case]
- [ ] CHK016 Are the high-correctness-risk workers (outbox publisher, PENDING_REFERENCE reprocessor) given observability signals (lag, claim contention, retries)? [Coverage]
