# Integrations

Source of truth for every internal and external integration: contracts, auth model,
ownership, and failure handling. Status: **spec-only** — contracts below are
prescribed by `../README.md`; no implementation exists yet.

## Integration Catalog

| # | Integration | Direction | Transport | Status |
|---|---|---|---|---|
| 1 | Game providers | inbound | HTTP `POST /wagering/transactions` + `Idempotency-Key` | prescribed by spec §9 |
| 2 | Game providers | inbound | SQS `wager-transactions.fifo` (LocalStack/MiniStack locally) | prescribed by spec §10 |
| 3 | Integration events | outbound | SQS via transactional outbox | prescribed by spec §11 |
| 4 | Identity Provider (OIDC) | inbound | HTTP | optional — decision pending (spec §2) |
| 5 | PostgreSQL | internal | SQL | system of record; assumed temporarily unavailable |

## Authentication and Access

| Integration | Auth model |
|---|---|
| HTTP transaction API | Candidate's choice: external IdP (Keycloak/Zitadel or equivalent) or documented no-op `AuthGuard` extension point. Never a hand-rolled user table. |
| SQS ingress | Trusted internal channel; the `providerId` inside the message still undergoes full domain validation. |
| Health endpoints (`/health/live`, `/health/ready`) | Unauthenticated (explicitly out of auth scope, spec §2). |
| Outbound events | Internal channel; consumers must tolerate duplicate delivery (at-least-once). |
| PostgreSQL | Not internet-exposed; accessed only from the app network. |

## Contracts and Data Flows

### HTTP (spec §9)

- `POST /wallets`, `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger?cursor=&limit=`
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `POST /wagering/transactions` (header `Idempotency-Key`, default `{providerId}:{externalTransactionId}`)
- `POST /wallets/:walletId/reconciliation`
- Status-code mapping must consistently distinguish: invalid payload, idempotency
  conflict, business rejection, accepted-but-pending, transient infrastructure failure.

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
| IdP (if adopted) | external IdP | — | auth failure ≠ business rejection; health stays open |
| PostgreSQL | this service | — | schema enforces invariants |

New integrations must add a row to the catalog plus auth, contract, failure, and
ownership entries above before implementation starts.
