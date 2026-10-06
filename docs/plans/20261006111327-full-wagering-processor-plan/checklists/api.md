# API Requirement Quality Checklist

Plan: `docs/plans/20261006111327-full-wagering-processor-plan.md`
Domain: api

- [ ] CHK001 Are all spec §9 endpoints (submit, wallet create/get, ledger, reconciliation, transaction lookups) specified with method, path, request shape, and response shape? [Completeness]
- [ ] CHK002 Is the HTTP status mapping (200/201/400/401/403/404/409/422/202/503) fully enumerated with a distinct `code` value for every failure class? [Completeness]
- [ ] CHK003 Is the error response body schema (`statusCode, code, message, failureCode?, transactionId?, idempotentReplay?, correlationId?`) specified as required vs optional for every status? [Clarity]
- [ ] CHK004 Is `Idempotency-Key` specified as required-vs-optional per endpoint, and is the 400 behavior on a missing header explicit? [Clarity]
- [ ] CHK005 Is the replay contract (original response repeated, `idempotentReplay: true`, original balance snapshot) stated identically for successes and stored rejections? [Consistency]
- [ ] CHK006 Do AC-3 (`200 PROCESSED`) and the Proposed Solution status mapping (full set per CHK002) agree on every documented code path? [Consistency]
- [ ] CHK007 Is `PENDING_REFERENCE` the only body `status` value mapped to 202, with `PENDING` explicitly internal in-flight only and never returned by HTTP? [Measurability]
- [ ] CHK008 Are acceptance criteria written Given/When/Then with observable outcomes (status codes, body fields, row counts) rather than implementation hints? [Measurability]
- [ ] CHK009 Are out-of-order, duplicate, and conflict scenarios covered as request-level scenarios (AC-5, AC-6, AC-9, AC-12)? [Coverage]
- [ ] CHK010 Are edge cases specified: missing `Idempotency-Key`, `kind: OPENING` via HTTP, unknown wallet, unknown transaction lookup, currency mismatch? [Edge Case]
- [ ] CHK011 Is the ledger pagination contract (opaque cursor semantics, default/max limit, ordering, stability under inserts) fully specified? [Completeness]
- [ ] CHK012 Are API dependencies on external components (Keycloak tokens, PostgreSQL, SQS) stated as assumptions with their failure behavior (401/403 vs 503)? [Dependencies and assumptions]
- [ ] CHK013 Are all six brainstorm ⚠️ OPEN decisions (broker, failureCode taxonomy, retry limits, status mapping, payloadHash, money storage) resolved with rationale traceable to a plan section? [Completeness]
- [ ] CHK014 Is the BRL-only currency scope stated while cross-currency conflict remains a testable requirement (spec §13 "conflito de moeda")? [Consistency]
- [ ] CHK015 Are the spec §9 request/response examples preserved as the authoritative provider-facing contract (no silent field renames)? [Coverage]
- [ ] CHK016 Is dual ingress (HTTP + SQS → same use case) specified as one shared contract rather than two divergent payload paths? [Consistency]
