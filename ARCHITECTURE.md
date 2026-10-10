# Architecture — Distributed Wagering Processor

> **Graded artifact per spec §14** — decisions, trade-offs, and limitations summary.
> Full source of truth: [`docs/architecture.md`](docs/architecture.md).

---

## System Overview

A distributed wagering processor that accepts provider operations (`BET → WIN | LOSS | REFUND | ROLLBACK`) over HTTP and SQS, applies them to player wallets with a strictly consistent, auditable ledger. Delivery is at-least-once; the system stays correct under duplication, out-of-order arrival, concurrent processing across 3+ instances, and crashes.

**Boundaries:**
- **Ingress**: HTTP API (`POST /wagering/transactions`, wallet endpoints, queries) + SQS consumer — both funnel into the **same use case**.
- **Domain**: `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage` — state encapsulated behind private constructors + static factories (`create`/`from`/`rehydrate`).
- **Persistence**: PostgreSQL with schema-enforced uniqueness, immutability, and non-negativity.
- **Egress**: integration events published from a transactional outbox.

---

## Technology Stack (spec-prescribed)

| Layer | Choice | Version / Notes |
|-------|--------|-----------------|
| Runtime | Bun | 1.4.2+ (1.3.14 fails NestJS DI) |
| Language | TypeScript | strict mode, ES2022 |
| Framework | NestJS | 12.x, `APP_PIPE`/`APP_FILTER`/`APP_GUARD` wiring |
| Database | PostgreSQL | 16, MikroORM 7.x (explicit UoW, `transactional()`, `LockMode.PESSIMISTIC_WRITE`) |
| Messaging | AWS SQS (FIFO) | LocalStack 4.13.1 locally |
| Auth | Keycloak OIDC | 26.8, realm `wagering`, roles `transact:read`/`transact:write` |
| Observability | pino + Prometheus | `GET /metrics` public, structured JSON logs with redaction |
| Orchestration | Docker Compose | PostgreSQL 16, LocalStack 4.13.1, Keycloak 26.8 |

---

## Key Decisions & Trade-offs

| Area | Decision | Rationale / Trade-off |
|------|----------|----------------------|
| **ORM** | MikroORM | Explicit Unit of Work (`em.transactional()`), `LockMode.PESSIMISTIC_WRITE`, Identity Map — avoids implicit sessions and N+1 issues. Trade-off: steeper learning curve vs. TypeORM. |
| **Concurrency** | Pessimistic row lock (`SELECT ... FOR UPDATE`) on `walletId` | Serializes contention per wallet; proven correct under real parallelism (Phase 5 suite: hot-wallet, 50× duplicate, 3-instance). Trade-off: slightly higher latency under contention vs. optimistic retry loops. |
| **Idempotency** | Persisted inbox + `Idempotency-Key` + `payloadHash` (canonical JSON, sorted keys) | Survives crashes/restarts; different payload under same key = conflict (not replay). Trade-off: extra DB write per request; avoids memory-only solutions. |
| **Out-of-order refs** | `PENDING_REFERENCE` state + scheduled worker with exponential backoff (max 10 attempts, 24h TTL) | Allows `REFUND`/`ROLLBACK` before `BET`; worker resolves on reference arrival. Trade-off: eventual consistency for reversals; explicit `failureCode` (`REFERENCE_NOT_FOUND`) on TTL expiry. |
| **Auth** | Keycloak OIDC (JWKS, issuer + audience + exp validation) | Fail-closed: JWKS failure → 401; `@Public()` on `/health/*` + `GET /metrics`; `@Roles('transact:write')` on POSTs, `transact:read` on GETs. Trade-off: external dependency (Keycloak) but avoids custom auth. |
| **Observability** | pino (JSON, redaction: `authorization`, `data`/`payload`/`body` at any depth) + correlation ID middleware (ALS) + Prometheus metrics | Structured logs, no secrets in logs, correlation IDs propagate through logs and HTTP headers. Trade-off: pino config complexity for redaction paths. |
| **Outbox** | Transactional outbox (`OutboxMessage` in same DB tx) + publisher worker (`FOR UPDATE SKIP LOCKED`, batch 50, exponential backoff) | At-least-once delivery; consumers must be idempotent. Trade-off: publisher runs post-commit → crash between commit and publish = re-publish on restart (acceptable per spec). |
| **Schema guarantees** | CHECK (`balance_amount >= 0`), UNIQUE (`playerId`+`currency`, `idempotencyKey`, `providerId`+`externalTransactionId`, partial unique on `reference_transaction_id`+`kind` WHERE `status='PROCESSED'`), trigger for ledger immutability | DB enforces invariants; application code cannot bypass. Trade-off: schema changes require migrations; partial unique indexes require raw SQL in migration. |

---

## Module Boundaries & Safe-Change Guidance

| Module | Responsibility | Must Not |
|--------|----------------|----------|
| HTTP controllers | validate/transport, map status codes | contain business rules |
| Auth guards (`src/auth/`) | global JWT verification + realm roles (`@Roles`), `@Public()` opt-out | contain business rules |
| Observability (`src/observability/`) | pino logging, correlation ID, `/metrics` | change business behavior |
| SQS consumer | envelope handling, ack lifecycle (inbox dedup inside use case) | duplicate use case logic |
| Use case (`src/modules/wagering/`) | orchestrate domain + persistence atomically | bypass domain factories |
| Domain aggregates (`src/domain/`) | money math, state transitions, invariants | depend on ORM/Nest decorators |
| Persistence (`src/database/`) | entities, mappers, repositories, migrations, constraints | weaken schema guarantees |
| Outbox publisher | post-commit event publication | publish before commit |
| Reconciliation | report ledger vs balance divergence | silently correct data |

---

## Data & Request Flow

```
HTTP controller ──┐
                  ├─→ Use case (application service)
SQS consumer  ────┘        │
                           ├─→ Domain (Wallet / WagerTransaction / Money)
                           ├─→ PostgreSQL transaction:
                           │     wallet balance + ledger entry + inbox dedup + outbox event
                           └─→ outbox worker → SQS (event publish, post-commit)
```

- **Idempotent submit**: `Idempotency-Key` + `payloadHash` (canonical JSON, sorted keys) → replay returns original result + `idempotentReplay: true`; different payload under same key → 409 conflict.
- **Out-of-order refs**: `REFUND`/`ROLLBACK` without reference → `PENDING_REFERENCE`; worker retries with backoff, then rejects with `failureCode: REFERENCE_NOT_FOUND`.
- **Reconciliation**: recomputes balance from ledger, logs/metrics divergence, never auto-corrects.

---

## Concurrency Correctness (Phase 5 Evidence)

| Test | Scenario | Result |
|------|----------|--------|
| Hot wallet (`tests/concurrency/hot-wallet.spec.ts`) | 2× `80.00` bets on `100.00` wallet | 1 `PROCESSED`, 1 `REJECTED INSUFFICIENT_FUNDS`, balance `20.00`, 1 `DEBIT` |
| Duplicate flood (`tests/concurrency/duplicate-flood.spec.ts`) | 50× same key/payload | 1 stored tx, 1 debit, 49 `idempotentReplay: true` |
| Multi-instance (`tests/concurrency/multi-instance.spec.ts`) | 3 logical instances, shared + distinct wallets | `balance == Σledger` for all; no duplicate debits |

All pass under real parallelism (no mocks).

---

## Resilience & Recovery (Phase 9)

| Scenario | Behavior |
|----------|----------|
| Consumer crash after commit, before ack | Inbox dedup absorbs redelivery → `idempotentReplay: true`, no duplicate effect |
| PG down | `/health/ready` → 503; submit → 503 `SERVICE_UNAVAILABLE` + `Retry-After: 5` |
| PG recovers | Service auto-recovers; final invariant `wallet.balance == Σledger` holds |
| Process crash after commit, before outbox publish | Outbox row remains `published_at=NULL` → worker picks up on restart → at-least-once publish |
| Two publishers on same outbox | `FOR UPDATE SKIP LOCKED` claims disjoint batches → no lost rows, no duplicates |

---

## Known Limitations & Deferred Work

| Item | Status | Note |
|------|--------|------|
| Idempotency key scoped per provider | Deferred | Current key is global; squatting possible. Requires migration adding `(provider_id, key)` unique index. |
| Read-path unwrap (no transaction for GET) | Deferred | Reads run in short transactions; root-EM factory, `allowGlobalContext: false`. |
| Single-flush optimization (`save()` = `findOne` + `flush`) | Deferred | ~11 SQL round-trips per submit; candidate for T039 migration review. |
| Read-path provider scoping | Deferred | `GET /wagering/transactions/:id` accessible by any caller with UUID. Phase 8 tokens bind `providerId`, revisit with T039. |
| Distributed tracing (W3C `traceparent`) | Not implemented | Correlation ID propagation exists; OpenTelemetry integration optional. |
| Load test scaffold (`bun run test:load`) | Optional (T055) | Not required for delivery; methodology documented if implemented. |

---

## Verification Evidence (Phase 9 Baseline — 2026-10-09)

| Gate | Result |
|------|--------|
| `bun run validate` (`tsc --noEmit`) | exit 0 (with `GOMEMLIMIT=1200MiB`) |
| Unit tests | 256 pass / 0 fail (26 files) |
| Integration suites (individual) | 14 suites green: auth-observability 13, wallets.http 23, wagering.http 23, http-api 8, bootstrap 6, metrics 3, sqs-ingress 7, submit-tx 27, workers 4, outbox 2, pending-ref 5, repositories 10, schema 25, wallets.service 7 |
| Concurrency | 10 pass / 0 fail (4 files) |
| Keycloak live tokens | 4 users verified: `sub`, `aud=wagering-api`, `preferred_username`, `realm_access.roles` |
| Full suite (sequential) | Green |

---

## References

- Full source of truth: [`docs/architecture.md`](docs/architecture.md)
- Infrastructure: [`docs/infrastructure.md`](docs/infrastructure.md)
- Integrations: [`docs/integrations.md`](docs/integrations.md)
- Environments: [`docs/environments.md`](docs/environments.md)
- Glossary: [`docs/glossary.md`](docs/glossary.md)
- Patterns: [`docs/solutions/patterns/`](docs/solutions/patterns/)
- Plan: [`docs/plans/20261006111327-full-wagering-processor-plan.md`](docs/plans/20261006111327-full-wagering-processor-plan.md)