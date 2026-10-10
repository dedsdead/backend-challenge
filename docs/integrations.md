# Integrations

Source of truth for every internal and external integration: contracts, auth model,
ownership, and failure handling. Status: **foundation + domain + persistence +
HTTP API + concurrency hardening (Phases 1–5, 2026-10-06/08), SQS ingestion +
workers (Phases 6–7), auth + observability (Phase 8, 2026-10-09), resilience
suite (Phase 9, 2026-10-09)** — the local
stack, unauthenticated health + `GET /metrics` endpoints, domain model,
integration events (`src/events/`), inbox/outbox persistence (`src/database/` —
`inbox_message`/`outbox_message` tables, repositories), the provider HTTP routes
(`src/modules/wallets/`, `src/modules/wagering/` — **guarded** since Phase 8 by
the global `JwtGuard` + `RolesGuard` in `src/auth/`), the **concurrency test
suite** (`tests/concurrency/` — hot-wallet, duplicate-flood, multi-instance,
distinct-wallets-parallel, restart-consistency-sweep tests
proving correctness under real parallelism), the SQS consumer / outbox publisher /
pending-reference worker (`src/messaging/`, `src/workers/`), **crash-recovery
integration tests** (`tests/integration/crash-recovery.spec.ts`), **idempotency
edge unit tests** (`tests/unit/common/idempotency/payload-hash.spec.ts`), and **metrics
instrumentation** (`src/common/metrics/metrics.ts` — a facade over
`src/observability/metrics.service.ts`, served at `GET /metrics`) exist.
Contracts below are prescribed by `../README.md` except where a row states
otherwise.

## Integration Catalog

| # | Integration | Direction | Transport | Status |
|---|---|---|---|---|
| 1 | Game providers | inbound | HTTP `POST /wagering/transactions` + `Idempotency-Key` | prescribed by spec §9; all §9 routes implemented in Phase 4 (`src/modules/wallets/wallets.controller.ts`, `src/modules/wagering/wagering.controller.ts`); **enforced since Phase 8 (T044)** by the global guards (`JwtGuard` → `RolesGuard`, `src/auth/`): `transact:write` on POSTs, `transact:read` on GETs |
| 2 | Game providers | inbound | SQS `wager-transactions.fifo` (LocalStack locally — chosen over MiniStack, pinned 4.13.1) | prescribed by spec §10; both queues (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`, `MAX_RECEIVE_COUNT=5`) created locally via the idempotent `bun run queue:setup` (`scripts/create-queues.ts`, Phase 6); consumer in `src/messaging/wager-transaction.consumer.ts` |
| 3 | Integration events | outbound | SQS via transactional outbox | prescribed by spec §11; envelope + 4 events (`src/events/`), `outbox_message` table/repositories, and Phase 4 use cases enqueue rows in the same transaction (`src/modules/wagering/submit-transaction.use-case.ts`, `src/modules/wallets/wallets.service.ts`); publisher worker implemented (`src/workers/outbox-publisher.worker.ts`, Phase 7) |
| 4 | Identity Provider (OIDC) | inbound | HTTP | **decided: Keycloak** (2026-10-06); realm `wagering` fully exported in `keycloak/realm-export.json` (T043, Phase 8): realm roles `transact:read`/`transact:write`, clients `wagering-api` (bearer-only, audience) + `wagering-cli` (public, direct grant), 4 test users; JWT/JWKS validation live in `src/auth/jwt.guard.ts` + `src/auth/roles.guard.ts` (T044), guarded by `tests/unit/keycloak/realm-export.spec.ts` and the live-token check in `tests/helpers/keycloak-token.ts` |
| 5 | PostgreSQL | internal | SQL | system of record; assumed temporarily unavailable; schema owned by migration 001 (`src/database/migrations/Migration20261007000000_InitialMigration.ts` — CHECK constraints, partial unique index, ledger immutability trigger; FK question in [infrastructure.md](infrastructure.md) → Deferred gaps) |

## Authentication and Access

| Integration | Auth model |
|---|---|
| HTTP transaction API | **Keycloak** external IdP: OIDC JWT via JWKS, issuer/audience from env (`KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`). Roles: `transact:write` (POST), `transact:read` (GET); missing role → `403 ROLE_FORBIDDEN`, invalid/missing token → `401 UNAUTHORIZED` (fail-closed — see Failure Modes). Never a hand-rolled user table. **Enforced since Phase 8 (T044)** by the global `JwtGuard` (JWKS verify, sets `req.user`) + `RolesGuard` (`realm_access.roles` vs `@Roles`), registered as `APP_GUARD` in `src/app.module.ts` (JwtGuard first); health and `GET /metrics` opt out via `@Public()` (`src/auth/public.decorator.ts`). |
| SQS ingress | Trusted internal channel; the `providerId` inside the message still undergoes full domain validation. |
| Health endpoints (`/health/live`, `/health/ready`) | Unauthenticated (explicitly out of auth scope, spec §2) — `@Public()` on both handlers in `src/health/health.controller.ts`, consumed by the global guards; readiness runs `SELECT 1` through the injected MikroORM `EntityManager` **and** the SQS queue probe (`SQS_PROBER`, `src/health/sqs-prober.ts`) → `{postgres:'ok', sqs:'ok'}` (T047); Keycloak is deliberately not probed (clarifications). |
| `GET /metrics` | Unauthenticated by design — intentional Prometheus scrape (aggregate counters/histograms only, no PII or financial payloads; assume network-restricted); the only `@Public` endpoint besides health, implemented in `src/observability/metrics.controller.ts` rendering the `prom-client` registry from `src/observability/metrics.service.ts` (T046). |
| Outbound events | Internal channel; consumers must tolerate duplicate delivery (at-least-once). |
| PostgreSQL | Not internet-exposed; accessed only from the app network. |

## Contracts and Data Flows

### HTTP (spec §9)

All routes below are implemented (Phase 4; controllers referenced above) and —
except health and `GET /metrics` — require a Keycloak bearer token since Phase 8
(`401 UNAUTHORIZED` without one, `403 ROLE_FORBIDDEN` without the role). The
**transaction** reads are still not scoped to the calling provider: the Phase 8
guards authenticate and check `transact:read`/`transact:write`, but nothing binds
`providerId` to the token — open question, still deferred:

- `POST /wallets`, `GET /wallets/:walletId`,
  `GET /wallets/:walletId/ledger?cursor=&limit=` (keyset cursor base64url
  `{createdAt,id}`, `limit` 1–100 default 50)
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `POST /wagering/transactions` — **required** header `Idempotency-Key`
  (missing/blank/>255/comma-bearing → 400 `VALIDATION_ERROR`; recommended value
  `{providerId}:{externalTransactionId}`)
- `POST /wallets/:walletId/reconciliation`
- Status-code mapping must consistently distinguish (mirrored from plan §4):
  200 success, 201 created, 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`,
  403 `ROLE_FORBIDDEN`, 404 `NOT_FOUND`, 409 `IDEMPOTENCY_CONFLICT`/`WALLET_EXISTS`,
  422 `TRANSACTION_REJECTED`, 202 `PENDING_REFERENCE`,
  413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` (express-level
  rejections, handled by the Phase 4 filter rewrite),
  502 `BAD_GATEWAY`, 503 `SERVICE_UNAVAILABLE` (+ `Retry-After: 5`),
  504 `GATEWAY_TIMEOUT`.

### SQS message (spec §10)

Envelope: `messageId`, `type`, `occurredAt`, `data` — `data` carries `providerId`,
`externalTransactionId`, `idempotencyKey`, `playerId`, `walletId`, `roundId`,
`gameId`, `kind`, `money` (`{amount: "25.00", currency: "BRL"}`).

Flow: enqueue → consumer runs the same use case as HTTP → inbox dedup by
`(consumerName, messageId)` → ack only after SQL commit.

### Outbound events (spec §11)

| Event | When |
|---|---|
| `WagerTransactionProcessed` | any applied transaction, including `LOSS` |
| `WagerTransactionRejected` | rejected by business rule |
| `WalletBalanceChanged` | only when the balance changes |
| `WagerTransactionPendingReference` | referenced transaction not yet present |

Envelope (`IntegrationEvent` abstract base in `src/events/integration-event.ts`,
one concrete subclass per event in `src/events/` — all 4 events implemented in
Phase 2; emitted by the Phase 7 outbox publisher
`src/workers/outbox-publisher.worker.ts`, at-least-once):
`eventId`, `eventType`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt`
(ISO-8601), `version`, `data`. `data` carries `MoneyProps` (decimal strings), never
domain class instances.

## Failure Modes and Retries

| Failure | Handling |
|---|---|
| Business rule violation | terminal → ack HTTP with rejection + `failureCode`; SQS message acked |
| Transient (DB/broker unreachable) | retry with backoff; never partial commit |
| IdP/JWKS unreachable or invalid | auth path fails **closed**: `401 UNAUTHORIZED`, request never reaches business logic (never 500 — implemented in `src/auth/jwt.guard.ts`, T044) |
| Duplicate delivery / redelivery | inbox dedup → no duplicated effects |
| Missing reference | `PENDING_REFERENCE` → scheduled worker, exponential backoff → after attempt limit: `REJECTED` with distinct `failureCode` + event |
| Permanent consumer error | attempt limit exceeded → `wager-transactions-dlq.fifo` |
| Process death before publish | outbox row survives; another instance publishes |
| Process death before ack | SQS redelivery → inbox dedup makes it safe |
| `SIGTERM` mid-message | finish in-flight work or return message visibility |
| Idempotency key reused with different payload | conflict (409-class), not replay |

## Ownership

| Integration | Ownership | Limits | Notes |
|---|---|---|---|
| Provider HTTP ingress | external providers → this service | domain-validated payload | duplicate key + different payload = conflict |
| SQS ingress | platform / this service | attempt limit before DLQ | business → ack; transient → retry; permanent → DLQ |
| Outbound events | this service → consumers | at-least-once; consumers idempotent | outbox backoff; duplicate publish safe |
| IdP (Keycloak) | external IdP | — | auth failure ≠ business rejection; health + `/metrics` stay open |
| PostgreSQL | this service | — | schema enforces invariants |

New integrations must add a row to the catalog plus auth, contract, failure, and
ownership entries above before implementation starts.
