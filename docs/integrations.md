# Integrations

Source of truth for every internal and external integration: contracts, auth model,
ownership, and failure handling. Status: **foundation + domain + persistence +
HTTP API (Phases 1–4, 2026-10-06/08)** — the local stack, unauthenticated health
endpoints, domain model, integration events (`src/events/`), inbox/outbox
persistence (`src/database/` — `inbox_message`/`outbox_message` tables,
repositories, migration 001), and the provider HTTP routes
(`src/modules/wallets/`, `src/modules/wagering/` — live but **without any auth
guard** until plan T044) exist; no SQS producer/consumer, outbox publisher, or
JWT auth code yet. Contracts below are prescribed by `../README.md` except where a
row states otherwise.

## Integration Catalog

| # | Integration | Direction | Transport | Status |
|---|---|---|---|---|
| 1 | Game providers | inbound | HTTP `POST /wagering/transactions` + `Idempotency-Key` | prescribed by spec §9; all §9 routes implemented in Phase 4 (`src/modules/wallets/wallets.controller.ts`, `src/modules/wagering/wagering.controller.ts`) but running **without auth** until plan T044 |
| 2 | Game providers | inbound | SQS `wager-transactions.fifo` (LocalStack locally — chosen over MiniStack, pinned 4.13.1) | prescribed by spec §10; broker container up, queues not created yet (plan T034) |
| 3 | Integration events | outbound | SQS via transactional outbox | prescribed by spec §11; envelope + 4 events implemented (`src/events/`, Phase 2), `outbox_message` table/repositories implemented (Phase 3), and the Phase 4 use cases enqueue rows in the same transaction (`src/modules/wagering/submit-transaction.use-case.ts`, `src/modules/wallets/wallets.service.ts`); publisher worker planned (plan T038) |
| 4 | Identity Provider (OIDC) | inbound | HTTP | **decided: Keycloak** (2026-10-06); local container + placeholder realm `keycloak/realm-export.json` (realm `wagering`) implemented in Phase 1 — realm roles/client and JWT/JWKS validation still planned (plan T043–T044) |
| 5 | PostgreSQL | internal | SQL | system of record; assumed temporarily unavailable; schema owned by migration 001 (`src/database/migrations/Migration20261007000000_InitialMigration.ts` — CHECK constraints, partial unique index, ledger immutability trigger; FK question in [infrastructure.md](infrastructure.md) → Deferred gaps) |

## Authentication and Access

| Integration | Auth model |
|---|---|
| HTTP transaction API | **Keycloak** external IdP: OIDC JWT via JWKS, issuer/audience from env. Roles: `transact:write` (POST), `transact:read` (GET); missing role → `403 ROLE_FORBIDDEN`, invalid/missing token → `401 UNAUTHORIZED` (fail-closed — see Failure Modes). Never a hand-rolled user table. Not enforced yet — no global guard exists until plan T044 (health, wallet, and wagering endpoints are all live today without tokens — Phase 4 decision C3). |
| SQS ingress | Trusted internal channel; the `providerId` inside the message still undergoes full domain validation. |
| Health endpoints (`/health/live`, `/health/ready`) | Unauthenticated (explicitly out of auth scope, spec §2) — implemented with `@Public()` on both handlers in `src/health/health.controller.ts`; readiness runs `SELECT 1` through the injected MikroORM `EntityManager` (`src/health/health.service.ts`); the global JWT guard that consumes `@Public()` lands in plan T044. |
| `GET /metrics` | Unauthenticated by design — intentional Prometheus scrape (aggregate counters/histograms only, no PII or financial payloads; assume network-restricted); planned as the only `@Public` endpoint besides health (plan T046, not yet implemented). |
| Outbound events | Internal channel; consumers must tolerate duplicate delivery (at-least-once). |
| PostgreSQL | Not internet-exposed; accessed only from the app network. |

## Contracts and Data Flows

### HTTP (spec §9)

All routes below are implemented (Phase 4; controllers referenced above). The
**transaction** reads are not yet scoped to the calling provider — open question
deferred to the Phase 8 guards:

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
Phase 2; the outbox publishing pipeline that will emit them is planned):
`eventId`, `eventType`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt`
(ISO-8601), `version`, `data`. `data` carries `MoneyProps` (decimal strings), never
domain class instances.

## Failure Modes and Retries

| Failure | Handling |
|---|---|
| Business rule violation | terminal → ack HTTP with rejection + `failureCode`; SQS message acked |
| Transient (DB/broker unreachable) | retry with backoff; never partial commit |
| IdP/JWKS unreachable or invalid | auth path fails **closed**: `401 UNAUTHORIZED`, request never reaches business logic (never 500; plan T044) |
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
