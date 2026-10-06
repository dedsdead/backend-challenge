# Integrations

Source of truth for every internal and external integration: contracts, auth model,
ownership, and failure handling. Status: **foundation only** — the local stack and
unauthenticated health endpoints exist (Phase 1, 2026-10-06); no provider HTTP routes,
SQS producer/consumer, outbox, or JWT auth code yet. Contracts below are prescribed by
`../README.md` except where a row states otherwise.

## Integration Catalog

| # | Integration | Direction | Transport | Status |
|---|---|---|---|---|
| 1 | Game providers | inbound | HTTP `POST /wagering/transactions` + `Idempotency-Key` | prescribed by spec §9 |
| 2 | Game providers | inbound | SQS `wager-transactions.fifo` (LocalStack locally — chosen over MiniStack, pinned 4.13.1) | prescribed by spec §10; broker container up, queues not created yet (plan T034) |
| 3 | Integration events | outbound | SQS via transactional outbox | prescribed by spec §11 |
| 4 | Identity Provider (OIDC) | inbound | HTTP | **decided: Keycloak** (2026-10-06); local container + placeholder realm `keycloak/realm-export.json` (realm `wagering`) implemented in Phase 1 — realm roles/client and JWT/JWKS validation still planned (plan T043–T044) |
| 5 | PostgreSQL | internal | SQL | system of record; assumed temporarily unavailable |

## Authentication and Access

| Integration | Auth model |
|---|---|
| HTTP transaction API | **Keycloak** external IdP: OIDC JWT via JWKS, issuer/audience from env. Roles: `transact:write` (POST), `transact:read` (GET); missing role → `403 ROLE_FORBIDDEN`, invalid/missing token → `401 UNAUTHORIZED` (fail-closed — see Failure Modes). Never a hand-rolled user table. Not enforced yet — no global guard exists until plan T044 (only health endpoints are live today). |
| SQS ingress | Trusted internal channel; the `providerId` inside the message still undergoes full domain validation. |
| Health endpoints (`/health/live`, `/health/ready`) | Unauthenticated (explicitly out of auth scope, spec §2) — implemented with `@Public()` on both handlers in `src/health/health.controller.ts`; the global JWT guard that consumes it lands in plan T044. |
| `GET /metrics` | Unauthenticated by design — intentional Prometheus scrape (aggregate counters/histograms only, no PII or financial payloads; assume network-restricted); planned as the only `@Public` endpoint besides health (plan T046, not yet implemented). |
| Outbound events | Internal channel; consumers must tolerate duplicate delivery (at-least-once). |
| PostgreSQL | Not internet-exposed; accessed only from the app network. |

## Contracts and Data Flows

### HTTP (spec §9)

- `POST /wallets`, `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger?cursor=&limit=`
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `POST /wagering/transactions` (header `Idempotency-Key`, default `{providerId}:{externalTransactionId}`)
- `POST /wallets/:walletId/reconciliation`
- Status-code mapping must consistently distinguish (mirrored from plan §4):
  200 success, 201 created, 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`,
  403 `ROLE_FORBIDDEN`, 404 `NOT_FOUND`, 409 `IDEMPOTENCY_CONFLICT`/`WALLET_EXISTS`,
  422 `TRANSACTION_REJECTED`, 202 `PENDING_REFERENCE`,
  503 `SERVICE_UNAVAILABLE`.

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

Envelope (`IntegrationEvent` abstract base, one concrete subclass per event):
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
