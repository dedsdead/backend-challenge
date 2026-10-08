---
module: wallets
title: Wallets Module
repo: backend
path: src/modules/wallets/
last_updated: 2026-10-08
entities:
  - Wallet
  - WagerTransaction
  - WalletLedgerEntry
  - OutboxMessage
---

# Wallets Module

## Overview

The wallets module owns the player-wallet lifecycle and the money-audit surface of the
wagering processor: it opens a wallet for a `(playerId, currency)` pair with an optional
initial balance (minted as an internal `OPENING` transaction plus a `CREDIT` ledger entry
in the same SQL transaction), serves wallet reads and a keyset-paginated immutable ledger,
and runs reconciliation — comparing the stored `wallet.balance` against the sum of the
ledger and *reporting* any divergence without ever auto-correcting it (spec §9, AC-1,
AC-2, AC-17, AC-21, G18). It is the entry point through which money first enters the
system; every later balance change flows through the wagering module's submit use case
against the same wallet row.

## Source of Truth Files

- `src/modules/wallets/wallets.module.ts`
- `src/modules/wallets/wallets.controller.ts`
- `src/modules/wallets/wallets.service.ts`
- `src/modules/wallets/reconciliation.service.ts`
- `src/modules/wallets/ledger-cursor.codec.ts`
- `src/modules/wallets/dto/create-wallet.dto.ts`
- `src/modules/wallets/dto/wallet-response.dto.ts`
- `src/modules/wallets/dto/ledger-query.dto.ts`
- `src/modules/wallets/dto/ledger-page-response.dto.ts`
- `src/modules/wallets/dto/reconciliation-response.dto.ts`
- Error contract: `src/common/http/exception.filter.ts` (global, `APP_FILTER`)
- Validation contract: `src/app.module.ts` (global `ValidationPipe` with
  `whitelist` + `forbidNonWhitelisted` + `transform` + flattening `exceptionFactory`)

## Current Implementation Snapshot

- `@Module({ controllers: [WalletsController], providers: [WalletsService, ReconciliationService] })` — no `imports`, no `exports`.
- 4 endpoints implemented: `POST /wallets`, `GET /wallets/:walletId`,
  `GET /wallets/:walletId/ledger`, `POST /wallets/:walletId/reconciliation`.
- **No auth on any endpoint today** — the Phase 4 decision is to run tokenless; JWT/role
  guards are plan **T044 (Phase 8)**. Tests explicitly assert this ("without tokens —
  guards arrive in plan T044").
- Every service method runs inside `em.transactional(...)` on the injected **root
  `EntityManager` (transaction factory)**; repositories are constructed **per
  transaction** (`new MikroOrmWalletRepository(tx)`), never injected as singletons;
  `allowGlobalContext: false` in `src/database/mikro-orm.config.ts`. Read paths
  (`get`, `listLedger`) intentionally stay inside short transactions — a pinned user
  decision (plan Execution Log 2026-10-08).
- Reconciliation runs at `IsolationLevel.REPEATABLE_READ`, logs a warning and bumps the
  in-process `metrics.reconciliationDivergence` **`CounterStub`** on divergence
  (prom-client instrument arrives with **T046 / Phase 8**).
- Zero-initial-balance wallets create **only** the wallet row (no `OPENING`, no ledger
  entry, no outbox event).

## Responsibilities

- Open wallets atomically and enforce one wallet per `(playerId, currency)` (G18 allows
  the same player in other currencies).
- Mint the internal `OPENING` transaction + `CREDIT` ledger entry + `WalletBalanceChanged`
  outbox row for non-zero initial balances (spec §9).
- Read wallet state and page the immutable ledger newest-first with an opaque keyset
  cursor (never OFFSET).
- Reconcile stored balance vs. ledger sum; report divergence (`consistent: false`) with a
  log line and a counter — never mutate data (AC-17/AC-17a).

## Public API

**Auth note:** there is currently **no guard** on these endpoints (no `JwtAuthGuard`,
no `@Public()` needed). The pinned error contract reserves `401 UNAUTHORIZED` and
`403 ROLE_FORBIDDEN` for when T044 (Phase 8) adds the global JWT + roles guards;
plan T043 gives `POST /wallets` and `POST /wallets/:walletId/reconciliation` the
`transact:write` role, the GETs `transact:read`. Organization-membership checks do not
exist in this codebase (no org model in this domain).

| Method | Path | Auth | Success | Description |
|--------|------|------|---------|-------------|
| `POST` | `/wallets` | none (Phase 4) | `201` | Create wallet for `playerId` + currency with initial balance |
| `GET` | `/wallets/:walletId` | none (Phase 4) | `200` | Read one wallet |
| `GET` | `/wallets/:walletId/ledger` | none (Phase 4) | `200` | Newest-first keyset page of ledger entries |
| `POST` | `/wallets/:walletId/reconciliation` | none (Phase 4) | `200` | Compare stored balance vs. ledger sum |

`:walletId` is parsed with `ParseUUIDPipe` → a non-UUID is `400 VALIDATION_ERROR`.

### `POST /wallets`

Request (`CreateWalletDto` — unknown fields are rejected by `forbidNonWhitelisted`):

```json
{ "playerId": "550e8400-e29b-41d4-a716-446655440000",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" } }
```

- `amount`: `/^\d{1,15}\.\d{2}$/` (non-negative, exactly 2 decimals); `currency`: `/^[A-Z]{3}$/`.
- `initialBalance` must be present (`@IsDefined()` — a missing object is a 400, not a 500).

Response `201` (`WalletResponseDto` — exact key set asserted by tests):

```json
{ "id": "<uuid>", "playerId": "<uuid>",
  "balance": { "amount": "1000.00", "currency": "BRL" }, "version": 1 }
```

### `GET /wallets/:walletId`

`200` with the same 4-key body as above. `404 NOT_FOUND` for an unknown wallet.

### `GET /wallets/:walletId/ledger?cursor=&limit=`

- Query (`LedgerQueryDto`): `cursor` optional opaque string; `limit` optional integer
  `1..100`, default `50`.
- Response `200` (`LedgerPageResponseDto`):

```json
{ "entries": [ { "id": "<uuid>", "transactionId": "<uuid>", "direction": "CREDIT",
    "amount": "10.00", "balanceBefore": { "amount": "0.00", "currency": "BRL" },
    "balanceAfter": { "amount": "10.00", "currency": "BRL" },
    "createdAt": "2026-10-08T12:00:00.000Z" } ],
  "nextCursor": "<base64url cursor>" | null }
```

- The cursor is `base64url({"createdAt": ISO-Z, "id": uuid})` — decode is strict
  (exact key set, ISO-Z and UUID regexes) and an undecodable cursor is
  `400 VALIDATION_ERROR` with message `"Invalid ledger cursor"`.
- **Validation precedes resource resolution**: a bad cursor/limit is `400` even when the
  wallet does not exist (controller comment + tests).
- Empty wallet → `{"entries": [], "nextCursor": null}` (AC-15).

### `POST /wallets/:walletId/reconciliation`

Response `200` (`ReconciliationResponseDto`):

```json
{ "walletId": "<uuid>",
  "storedBalance":   { "amount": "1000.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "1010.00", "currency": "BRL" },
  "difference":      { "amount": "-10.00", "currency": "BRL" },
  "consistent": false,
  "checkedEntries": 2 }
```

`difference = storedBalance − calculatedBalance`, a **signed** decimal string
(`/^-?\d{1,15}\.\d{2}$/`, so negatives are valid here). A negative ledger sum is still
`200` with `consistent: false` (review IM-2 — `Money.fromInternal`, never a 500).
Reconciliation never writes.

## Internal Design

**Transaction boundaries** (all via the injected root `EntityManager` used purely as a
transaction factory; `allowGlobalContext: false`):

| Operation | Transaction | Isolation | Repositories constructed inside |
|---|---|---|---|
| `create` | one `em.transactional` covering duplicate pre-check → wallet insert → (optional) `openWallet` | default | `MikroOrmWalletRepository`, `MikroOrmWagerTransactionRepository`, `MikroOrmWalletLedgerEntryRepository`, `MikroOrmOutboxMessageRepository` |
| `get` | short `em.transactional` (pinned decision: reads stay transactional) | default | `MikroOrmWalletRepository` |
| `listLedger` | short `em.transactional`: wallet existence check, then `pageByCursor` | default | `MikroOrmWalletRepository`, `MikroOrmWalletLedgerEntryRepository` |
| `reconcile` | `em.transactional` with `IsolationLevel.REPEATABLE_READ` (one snapshot for balance + sum + count) | `REPEATABLE_READ` | `MikroOrmWalletRepository`, `MikroOrmWalletLedgerEntryRepository` |

**`create` sequence** (`wallets.service.ts`):

1. `Money.from(initialBalance)` (domain validation).
2. Pre-check `findByPlayerIdAndCurrency` → existing ⇒ `WalletExistsError` (409).
3. `Wallet.open(...)` (domain: rejects negative initial balance, `version = 1`), `save`;
   a unique violation from `uq_wallet_player_currency` is caught via `isUniqueViolation`
   and re-mapped to `WalletExistsError` (double-check locking against a concurrent create).
4. Non-zero balance ⇒ `openWallet(tx, wallet, initialBalance)`:
   - internal `WagerTransaction` with `providerId: 'internal'`,
     `externalTransactionId: 'opening-<walletId>'`, `idempotencyKey: 'opening:<walletId>'`,
     `kind: OPENING`, `isInternal: true`, immediately `markProcessed` +
     `setResultBalance(initial)`;
     **NOT NULL workaround:** `roundId` and `gameId` columns are required (migration 001)
     but OPENING has no real round/game. Both are set to `wallet.id` as a deterministic
     sentinel. Documented here and in `wallets.service.ts:116-117`. Revisit with
     migration 002 (T039) to make columns nullable.
   - `WalletLedgerEntry` `CREDIT`, `balanceBefore = 0.00`, `balanceAfter = initial`;
   - `OutboxMessage.enqueue` of `WalletBalanceChanged` (`walletVersion`, `correlationId = opening id`).
   All four rows commit or roll back together (spec §9, AC-1).

**Domain collaborators:** `Money`, `Wallet` (immutable value-style object with
`open`/`rehydrate`), `WagerTransaction`, `WalletLedgerEntry`, `OutboxMessage`,
`WalletExistsError` / `NotFoundError` / `ValidationError` (`src/domain/errors.ts`).

**Ledger cursor codec** (`ledger-cursor.codec.ts`): `encodeLedgerCursor` /
`decodeLedgerCursor` — pure functions shared with `LedgerPageResponseDto`; the strict
decoder is what turns garbage into a domain `ValidationError` → 400.

**No pessimistic locking here** — creation is insert-only and correctness is enforced by
DB unique constraints; the wallet `FOR UPDATE` lock lives in the wagering submit path.

## Invariants and Guarantees

1. **One wallet per `(playerId, currency)`** — DB unique `uq_wallet_player_currency`
   + service pre-check + unique-violation mapping; a duplicate never produces a second
   row or a partial write (whole create is one SQL transaction).
2. **Opening atomicity** — wallet row + `OPENING` transaction + `CREDIT` ledger entry +
   `WalletBalanceChanged` outbox row commit in the *same* transaction; zero initial
   balance creates *only* the wallet row.
3. **Money never negative** — `ck_wallet_balance_non_negative` CHECK plus domain
   `InsufficientFundsError` in `Wallet.debit`.
4. **Ledger is append-only** — `BEFORE UPDATE OR DELETE` trigger (migration 001) raises
   on any mutation; `wallet_ledger_entry` rows carry `balance_before`/`balance_after`
   with a DB CHECK that they are arithmetically consistent with direction and amount.
5. **Reconciliation is read-only** — divergence ⇒ `logger.warn` + counter increment +
   `consistent: false`; the stored balance is never rewritten (AC-17).
6. **Deterministic pagination** — keyset on `(created_at, id) DESC`, parameterized, no
   OFFSET; pages are stable under concurrent inserts; cursor format is strict so stale or
   forged cursors fail as `400`, never as a 500 or a wrong page.
7. **Validation before existence** — cursor/limit errors (`400`) win over wallet
   existence (`404`).
8. **Exact response key sets** — tests assert `Object.keys(...).sort()`, so adding a
   response field is a contract change that must be made deliberately.
9. **EM/DI discipline** — services receive the root `EntityManager` and only use it as a
   transaction factory; repositories are instantiated per transaction on the `tx` EM.
   Never reach for a global EM (`allowGlobalContext: false`) or a repository singleton.
10. **`wallet.version`** is MikroORM's optimistic lock (`version: true`) and increments
    only when the balance changes.

## Error Mapping

Produced by `src/common/http/exception.filter.ts` (global). Error body shape:
`{ statusCode, code, message, failureCode?, errors?, correlationId?, ... }`.

| Condition | HTTP | `code` | Body detail |
|---|---|---|---|
| Valid create | `201` | — | 4-key wallet body |
| Duplicate `(playerId, currency)` | `409` | `WALLET_EXISTS` | `{statusCode, code, message}` |
| DTO violation (bad UUID, bad amount/currency, unknown field, missing `initialBalance`, `limit` out of `1..100`, non-numeric `limit`, malformed `:walletId`) | `400` | `VALIDATION_ERROR` | `message: "Validation failed"`, `errors: [{property, constraints}]` with dotted paths (`initialBalance.amount`) and non-empty constraint maps |
| Undecodable ledger cursor | `400` | `VALIDATION_ERROR` | `message: "Invalid ledger cursor"` |
| Unknown wallet on any read | `404` | `NOT_FOUND` | **no** `failureCode` |
| Transient infrastructure failure (PG down / connection refused) | `503` | `SERVICE_UNAVAILABLE` | `failureCode: INFRASTRUCTURE_ERROR` + `Retry-After: 5` |
| Anything unexpected | `500` | `INTERNAL_ERROR` | message masked to `"Internal server error"`, `errors` dropped |
| (Reserved) missing/invalid token | `401` | `UNAUTHORIZED` | surfaces only after T044 (Phase 8) |
| (Reserved) valid token, missing role | `403` | `ROLE_FORBIDDEN` | surfaces only after T044 (Phase 8) |

Client `x-correlation-id` matching `/^[A-Za-z0-9._-]{1,128}$/` is echoed as
`correlationId`.

## Events

Emitted as **`outbox_message` rows in the same SQL transaction as the state change**
(transactional outbox; actual publication to SQS is **Phase 7**, T038 — at-least-once):

- `WalletBalanceChanged` (version 1) — enqueued only when a wallet is created with a
  non-zero `initialBalance`. `aggregateId = walletId`, `correlationId = opening
  transaction id`, payload carries `transactionId`, `direction: CREDIT`,
  `money`, `balanceBefore`, `balanceAfter`, `walletVersion`.

This module does not emit `NOTIFICATION`-style notifications and has no
`NotificationsModule`; all downstream fan-out is outbox events.

## External Integrations

None. No AWS, no LLM, no third-party APIs. (S3/`StorageService` and Gemini are not used
in this repository.)

## Dependencies

**Imports (declared in `@Module`):** none.

**Providers:** `WalletsService`, `ReconciliationService`; **Controllers:**
`WalletsController`.

**Exports:** none — `WageringModule` does **not** import this module; cross-module reuse
happens through the shared MikroORM/EM wiring and the `src/database/repositories/`
implementations, not through exported services. `WalletsService` is additionally used
directly (constructed with an EM) by wagering integration tests to seed wallets.

**Implicit/global dependencies:** `AppModule` provides MikroORM (root), the global
`ValidationPipe` (`APP_PIPE`) and `HttpExceptionFilter` (`APP_FILTER`); `MoneyDto`
(`src/common/dto/money.dto.ts`), `payloadHash` (`src/common/idempotency/payload-hash.ts`),
`metrics` stub (`src/common/metrics/metrics.ts`), domain entities under `src/domain/`,
repositories under `src/database/repositories/`.

## Testing

| File | What it proves |
|---|---|
| `tests/integration/wallets.http.spec.ts` (21 tests) | Full HTTP contract of all 4 endpoints: `201` exact 4-key body; `409 WALLET_EXISTS` for duplicate; same player in another currency `201` (G18); `400 VALIDATION_ERROR` with per-field dotted `errors[]` and non-empty constraints (AC-24), including missing `initialBalance` → 400 not 500 (CR-1) and unknown fields → 400; `GET` body + `404` + malformed-UUID `400`; ledger newest-first keyset paging across 3 pages with no duplicate/skip (AC-21), stability under inserts between pages, empty envelope (AC-15), `limit` bounds `0/101/-1/abc` → 400, undecodable cursor → 400 (AC-21a), unknown wallet → 404; reconciliation consistent body, zero-balance wallet, seeded divergence → `consistent:false` + `difference:-10.00` + `logger.warn` + `metrics.reconciliationDivergence` +1 + wallet unchanged (never corrected, AC-17), unknown wallet → 404, negative ledger sum → 200 not 500 (IM-2), malformed walletId → 400. Runs **without tokens** (T029b). |
| `tests/integration/wallets.service.spec.ts` (7 tests) | Service-level behavior against real PG: creates with `version: 1`; non-zero initial balance persists `OPENING` (`PROCESSED`, `result_balance 100.00`) + one `CREDIT` ledger entry + `WalletBalanceChanged` outbox row; zero balance persists wallet row only (no tx, no ledger); duplicate ⇒ `WalletExistsError` with **nothing** persisted (original balance intact); same player different currency ⇒ distinct wallets; `get` returns stored wallet; `get` ⇒ `NotFoundError`. |
| `tests/unit/modules/wallets/ledger-cursor.codec.spec.ts` (8) | Cursor round-trip, query-safe base64url output, and strict rejection (garbage, non-JSON base64, missing `id`, non-UUID, invalid `createdAt`, extra/missing fields). |
| `tests/unit/modules/wallets/dto/wallet-response.dto.spec.ts` (2) | Response maps exactly `id, playerId, balance, version`. |
| `tests/unit/modules/wallets/dto/ledger-query.dto.spec.ts` (8) | Default `limit=50`, bounds `1..100`, non-numeric/negative rejected, cursor stays an opaque string. |
| `tests/unit/modules/wallets/dto/ledger-page-response.dto.spec.ts` (3) | Entry field mapping, opaque `nextCursor` when more pages exist, empty-page shape. |
| `tests/unit/modules/wallets/dto/reconciliation-response.dto.spec.ts` (7) | Signed `difference` accepts `0.00`/positive/negative, rejects `+`, non-decimals, negative `checkedEntries`; divergence mapping. |
| `tests/integration/http-api.spec.ts` (8 e2e scenarios, wallets parts) | Wallet lifecycle walk: create `version 1` → duplicate `409 WALLET_EXISTS` → second currency `201` (AC-1/AC-2/G18); reconciliation consistent + zero-balance (AC-17/AC-17b); `limit=1` ledger walk with no duplicates/skips and newest-first equality (AC-21); `OPENING` rejected externally (AC-18). |
| `tests/integration/bootstrap.spec.ts` (5) | Global `ValidationPipe` + `HttpExceptionFilter` actually registered; pipe enforces transform/whitelist; unknown route → `404 NOT_FOUND` contract body. |
| `tests/unit/common/http/exception.filter.spec.ts` (38) | The shared error contract this module relies on (400/404/409/422/500/503 mapping, masking, `Retry-After`, correlation-id validation). |

## Not Yet / Deferred

**Planned — not implemented today (explicitly marked; do not document as done):**

- **Auth / roles (T044, Phase 8):** no JWT guard, no `@Roles` — all four endpoints are
  unauthenticated. `401 UNAUTHORIZED` / `403 ROLE_FORBIDDEN` exist only in the pinned
  contract and the filter mapping, not in any live path.
- **Metrics (T046, Phase 8; T033, Phase 5):** `metrics.reconciliationDivergence` is an
  in-process `CounterStub` (`src/common/metrics/metrics.ts`), not a Prometheus counter;
  there is no `GET /metrics` yet.
- **Structured logging / correlation propagation (T045, Phase 8):** `ReconciliationService`
  uses the plain Nest `Logger`; no pino bindings or redaction yet.
- **Concurrency suites (T030–T033, Phase 5):** hot-wallet / duplicate-flood /
  multi-instance tests do not exist; nothing in this module is proven under real
  parallelism yet.
- **Performance follow-ups (candidate review with T039 / Phase 7):** per-`save()`
  `findOne + flush` round trips; `pageByCursor` `$or` predicate could become a row-value
  predicate.
- **Read-path transactions stay** (pinned decision, not a gap): reviewer suggestion to
  unwrap read paths was rejected because it contradicts the root-EM /
  `allowGlobalContext: false` design.

**Explicitly out of scope for this module:** SQS consumer (Phase 6), outbox publisher and
pending-reference worker (Phase 7) — but note the module already writes the outbox rows
those workers will publish.

## Safe Change Checklist for Future AI Work

1. Change `dto/*ResponseDto.ts` **and** their unit specs together — HTTP tests assert the
   exact sorted key sets, so any added/removed field must be updated in
   `wallets.http.spec.ts` (and `http-api.spec.ts`) in the same change.
2. Any change to wallet creation must preserve single-transaction atomicity of
   wallet + `OPENING` + ledger + outbox (`wallets.service.spec.ts` asserts all four
   together); keep the unique-violation → `WalletExistsError` mapping.
3. Changing the cursor format requires `ledger-cursor.codec.ts` +
   `LedgerPageResponseDto.from` + `ledger-cursor.codec.spec.ts` together; old cursors
   must keep failing as `400 "Invalid ledger cursor"` (never 500).
4. New request fields go through `CreateWalletDto`/`LedgerQueryDto`; because
   `forbidNonWhitelisted` is on, unknown client fields must remain `400` — add
   `@IsDefined()`-style guards for any nested object to avoid a `500` (CR-1 regression).
5. Never add a write/mutation to `ReconciliationService` (AC-17: report, never correct)
   and keep `REPEATABLE_READ` + `Money.fromInternal` (IM-2).
6. Do not add guards or role decorators until T044 (Phase 8) lands globally; when it
   does, only update the Auth column in this doc and add role expectations to
   `auth-observability.spec.ts` — the controller itself stays guard-free.
7. Verify with `bun run validate` then `bun test` (integration requires the compose
   stack: PostgreSQL/LocalStack/Keycloak up).
