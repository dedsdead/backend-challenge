---
module: wagering
title: Wagering Module
repo: backend
path: src/modules/wagering/
last_updated: 2026-10-09
entities:
  - WagerTransaction
  - Wallet
  - WalletLedgerEntry
  - InboxMessage
  - OutboxMessage
---

# Wagering Module

## Overview

The wagering module is the money-moving heart of the processor: it accepts provider
operations (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) over HTTP — and by design over
SQS — funneling both ingress paths into a single `SubmitTransactionUseCase` that applies
each operation to a player wallet inside **one SQL transaction**: inbox dedup (SQS) →
idempotency replay/conflict → duplicate-external-id conflict → wallet `FOR UPDATE` lock →
currency check → reference resolution for reversals → balance movement + immutable ledger
entry → durable stored rejection when applicable → transactional-outbox events
(spec §7, §9, AC-3…AC-12, AC-18…AC-20, AC-25, AC-28). It guarantees exactly-once
*effects* per idempotency key under duplicated, out-of-order, and concurrent delivery,
and exposes read endpoints for transaction status polling.

## Source of Truth Files

- `src/modules/wagering/wagering.module.ts`
- `src/modules/wagering/submit-transaction.use-case.ts` (core submit flow)
- `src/modules/wagering/wagering.controller.ts` (HTTP contract incl. `Idempotency-Key`)
- `src/modules/wagering/wagering.service.ts` (read-side lookups)
- `src/modules/wagering/dto/submit-transaction.dto.ts`
- `src/modules/wagering/dto/transaction-response.dto.ts`
- Error contract: `src/common/http/exception.filter.ts` (global)
- Validation contract: `src/app.module.ts` (global `ValidationPipe`)
- Auth (global, Phase 8): `src/auth/jwt.guard.ts`, `src/auth/roles.guard.ts`,
  `src/auth/roles.decorator.ts`, `src/auth/public.decorator.ts`
- `src/common/idempotency/payload-hash.ts` (canonical JSON + SHA-256)
- Domain: `src/domain/wager-transaction/wager-transaction.ts`, `src/domain/wallet/wallet.ts`,
  `src/domain/failure-codes.ts`, `src/domain/errors.ts`

## Current Implementation Snapshot

- `@Module({ controllers: [WageringController], providers: [SubmitTransactionUseCase, WageringService] })` — no `imports`, no `exports`.
- 3 endpoints: `POST /wagering/transactions`, `GET /wagering/transactions/:transactionId`,
  `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.
- `SubmitTransactionUseCase.execute(cmd)` is ingress-agnostic:
  `ingress: { kind: 'http' } | { kind: 'sqs', messageId, consumerName }`. The SQS
  consumer `src/messaging/wager-transaction.consumer.ts` (Phase 6) feeds it from
  `wager-transactions.fifo`; the inbox dedup step for SQS ingress is implemented
  and covered by tests.
- All DB access happens in explicit `em.transactional` blocks on the injected root
  `EntityManager`; repositories (`MikroOrmWalletRepository`,
  `MikroOrmWagerTransactionRepository`, `MikroOrmWalletLedgerEntryRepository`,
  `MikroOrmOutboxMessageRepository`, `MikroOrmInboxMessageRepository`) are constructed
  **inside each transaction**; `allowGlobalContext: false`. Read endpoints run in short
  transactions too (pinned decision).
- **Auth enforced since Phase 8 (T044)** — global `JwtGuard` + `RolesGuard`
  (`APP_GUARD` in `src/app.module.ts`); roles: **`transact:write` on the POST,
  `transact:read` on the GETs** (`@Roles` in `wagering.controller.ts`), with
  `401 UNAUTHORIZED` / `403 ROLE_FORBIDDEN` asserted in
  `tests/integration/auth-observability.spec.ts` and the HTTP suites sending real
  Keycloak tokens (`tests/helpers/keycloak-token.ts`). Metrics are Prometheus
  instruments in `src/observability/metrics.service.ts` (re-exported by
  `src/common/metrics/metrics.ts`) served at `GET /metrics` — **T046 done**;
  pino structured logging + correlation middleware landed in **T045**; the SQS
  consumer is **Phase 6** (`src/messaging/`); the pending-reference worker is
  **Phase 7** (`src/workers/`).
- `Idempotency-Key` header is validated in the controller **before any DB write**.
- **Lock-conflict instrumentation** (Phase 5, T033): `metrics.wageringLockConflictsTotal`
  increments when `findByIdForUpdate` wait exceeds 50ms; `metrics.wageringTxTotal`
  (`processed`, `rejected`, `pendingReference`) and `metrics.wageringProcessingSeconds`
  are recorded at transaction completion.

## Responsibilities

- Accept a provider transaction exactly once per `Idempotency-Key`, replaying or
  conflicting deterministically (AC-5, AC-6, AC-19, G12).
- Serialize concurrent submissions per wallet with a pessimistic `FOR UPDATE` lock and
  apply balance/ledger effects atomically (AC-3, AC-7, AC-11).
- Store business rejections durably as `REJECTED` rows (auditable) with `failureCode` and
  a result-balance snapshot — never as silent drops (AC-4).
- Resolve `REFUND`/`ROLLBACK` references with per-type single-reversal semantics and park
  out-of-order references as `PENDING_REFERENCE` (AC-8, AC-9, AC-25).
- Enqueue integration events via the transactional outbox (`WagerTransactionProcessed` |
  `WagerTransactionRejected` | `WagerTransactionPendingReference` + `WalletBalanceChanged`).
- Provide status lookups by transaction id and by `(providerId, externalTransactionId)`
  with no cross-provider existence oracle (AC-20, AC-28).

## Public API

**Auth note:** guarded by the **global** `JwtGuard` + `RolesGuard` (`src/auth/`,
registered in `src/app.module.ts`); the controller only declares `@Roles` —
`transact:write` on `POST /wagering/transactions`, `transact:read` on both GETs.
Missing/invalid token ⇒ `401 UNAUTHORIZED`, missing realm role ⇒
`403 ROLE_FORBIDDEN` (fail-closed; see `tests/integration/auth-observability.spec.ts`).
The token carries no `providerId`, so the by-UUID read stays unscoped (Deferred).

### Use-case entry point (the real public surface)

```ts
SubmitTransactionUseCase.execute(cmd: SubmitTransactionCommand): Promise<SubmitTransactionResult>

interface SubmitTransactionCommand {
  providerId: string; externalTransactionId: string;
  walletId: string; playerId: string; roundId: string; gameId: string;
  kind: WagerTransactionKind;              // BET | WIN | LOSS | REFUND | ROLLBACK (never OPENING)
  amount: string; currency: string;        // decimal string, ISO-4217
  referenceExternalTransactionId?: string; // required for REFUND/ROLLBACK
  idempotencyKey: string;
  ingress: { kind: 'http' } | { kind: 'sqs'; messageId: string; consumerName: string };
}

interface SubmitTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;   // PROCESSED | REJECTED | PENDING_REFERENCE (PENDING never escapes)
  balance?: { amount: string; currency: string };  // absent on WALLET_NOT_FOUND rejection
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}
```

`WageringService.getById(transactionId)` / `WageringService.getByProviderExternal(providerId, externalTransactionId)` are the read-side entry points (throw `NotFoundError` → 404).

### Endpoints

| Method | Path | Auth | Success | Description |
|--------|------|------|---------|-------------|
| `POST` | `/wagering/transactions` | `transact:write` + **required `Idempotency-Key` header** | `200` / `202` | Submit a transaction |
| `GET` | `/wagering/transactions/:transactionId` | `transact:read` | `200` | Status lookup by internal id |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | `transact:read` | `200` | Provider-scoped lookup |

#### `POST /wagering/transactions`

**Header `idempotency-key` (required):** non-blank, ≤ 255 chars, no commas, no
leading/trailing whitespace (`/^\S(?:.*\S)?$/`). Commas are rejected because Express
folds repeated headers with `", "` — a folded key could alias two distinct keys into one
stored idempotency identity (CR-6). Violations ⇒ `400 VALIDATION_ERROR` with
`errors[0].property = "idempotency-key"` **before anything is written**.

**Body (`SubmitTransactionDto`):**

```json
{ "providerId": "prov-1", "externalTransactionId": "ext-123",
  "playerId": "<uuid>", "walletId": "<uuid>", "roundId": "<uuid>", "gameId": "<uuid>",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" },
  "referenceExternalTransactionId": "ext-456" }
```

- `providerId`/`externalTransactionId`/`referenceExternalTransactionId`: non-empty,
  ≤ 255 chars (IM-6 — longer would be a `22001` → 500).
- `kind` ∈ `BET, WIN, LOSS, REFUND, ROLLBACK` — **`OPENING` is rejected with 400**
  (AC-18: only wallet creation mints `OPENING`).
- `referenceExternalTransactionId` is **mandatory for `REFUND`/`ROLLBACK`**
  (`@ValidateIf`) ⇒ 400 with that property in `errors[]`.
- Unknown fields ⇒ `400` (`forbidNonWhitelisted`).

**Responses:**

`200` — processed (exact keys asserted):

```json
{ "transactionId": "<uuid>", "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" }, "idempotentReplay": false }
```

`202` — accepted-pending (G5; **exactly** these three keys, no balance):

```json
{ "transactionId": "<uuid>", "status": "PENDING_REFERENCE", "idempotentReplay": false }
```

`422` — stored rejection (G14: **no balance** — a rejection never moves money):

```json
{ "statusCode": 422, "code": "TRANSACTION_REJECTED",
  "message": "Transaction rejected: INSUFFICIENT_FUNDS",
  "status": "REJECTED", "failureCode": "INSUFFICIENT_FUNDS",
  "transactionId": "<uuid>", "idempotentReplay": false }
```

Replays (`idempotentReplay: true`) repeat the original 200/202/422 body — including the
balance observed at original processing (`result_balance_amount/currency` snapshot, §7.7).

#### `GET /wagering/transactions/:transactionId`

`:transactionId` via `ParseUUIDPipe` → malformed ⇒ `400`; unknown ⇒ `404 NOT_FOUND`.
Response `200` (`TransactionResponseDto`):

```json
{ "transactionId": "<uuid>", "externalTransactionId": "ext-123", "kind": "BET",
  "status": "PROCESSED",
  "failureCode": "INSUFFICIENT_FUNDS",
  "balance": { "amount": "100.00", "currency": "BRL" } }
```

- `failureCode` is present **iff** `status == REJECTED`.
- `balance` is the result-balance snapshot for `PROCESSED`/`REJECTED` and **absent for
  `PENDING_REFERENCE`** (pollable status without a balance, AC-25/AC-28).
- The balance snapshot keeps the **wallet** currency — a `CURRENCY_MISMATCH` rejection
  must read back `{amount, currency: wallet currency}`, not the transaction currency
  (CR-2, `resultBalanceCurrency`).

#### `GET /providers/:providerId/wagering/transactions/:externalTransactionId`

Same 200 body. A transaction stored under a **different provider is invisible** (404) —
no cross-provider existence oracle (AC-20). Unknown external id ⇒ 404.

## Internal Design

**Transaction boundaries** — every path is an explicit `em.transactional` on the root EM
(never a global context; repositories built per transaction):

| Operation | Transaction | Notes |
|---|---|---|
| `execute` → `runInTx` | one tx per attempt | the whole submit pipeline below |
| `execute` retry (G1) | a **fresh** second tx | only entered on a unique violation (23505) |
| `resolveDuplicate` | one read-only tx | classifies the collision after the retry also failed |
| `getById` / `getByProviderExternal` | short read tx | pinned decision |

**Submit pipeline (`runInTx`), in order:**

1. **Inbox dedup (SQS ingress only):** `findByConsumerAndMessageId`; seen ⇒ look up the
   stored transaction by idempotency key, verify `payloadHash`, return replay (no
   effects). Not seen ⇒ insert `InboxMessage` (unique on
   `(consumer_name, message_id)`). HTTP ingress skips this step.
2. **Idempotency lookup:** `findByIdempotencyKey` → payload hash match ⇒ replay stored
   outcome (success, rejection, or pending) with original balance; mismatch ⇒
   `IdempotencyConflictError` (409).
3. **Duplicate external id:** `(providerId, externalTransactionId)` row exists under a
   *different* idempotency key ⇒ `IdempotencyConflictError` (409). Same key ⇒ it is our
   own row (G1 race) and must flow to the replay path, not conflict (CR-5).
4. Build the `WagerTransaction` (`WagerTransaction.create` validates reference
   requirement and internal-only `OPENING`).
5. **Wallet row lock:** `wallets.findByIdForUpdate(walletId)` (`LockMode.PESSIMISTIC_WRITE`
   → `FOR UPDATE`) — serializes concurrent submissions per wallet; must be inside the tx.
6. **Rejections so far** (stored via the shared `reject()` closure — row +
   `WagerTransactionRejected` outbox event, no movement): missing wallet ⇒
   `WALLET_NOT_FOUND` (no result balance); `wallet.balance.currency !== money.currency`
   ⇒ `CURRENCY_MISMATCH` (snapshot = wallet balance, even for `LOSS`).
7. **Reference resolution (`REFUND`/`ROLLBACK`):**
    - reference absent ⇒ `markPendingReference()` + snapshot current balance +
      `WagerTransactionPendingReference` outbox event + **202**, commit, no movement;
    - reference mismatch on provider/player/wallet/currency/round ⇒ `REFERENCE_MISMATCH`;
    - referenced transaction status not `PROCESSED` ⇒ `REFERENCE_NOT_PROCESSED`;
    - kind rules: `REFUND →` `BET` only; `ROLLBACK →` `BET | WIN | REFUND` ⇒
      otherwise `REFERENCE_INVALID_KIND`;
    - reversal amount must equal referenced transaction amount ⇒ `REFERENCE_AMOUNT_MISMATCH`;
    - an existing **applied same-kind** reversal ⇒ `REFERENCE_ALREADY_REVERSED`
      (`findAppliedReversal`, backed by partial unique index
      `uq_wager_tx_reference_kind` on `(reference_transaction_id, kind) WHERE status='PROCESSED'`
      — mixed-type reversal of one reference is allowed).
8. **Movement** (only when `affectsBalance()` — everything except `LOSS`): direction from
   `ledgerDirectionFor(reference)` (`ROLLBACK` = inverse of reference direction), then
   `wallet.credit/debit`. `InsufficientFundsError` ⇒ `INSUFFICIENT_FUNDS`, or
   `REVERSAL_EXCEEDS_BALANCE` when the transaction requires a reference. On success:
   save wallet (version+1), save `WalletLedgerEntry`.
9. **Commit outcome:** `markProcessed` + `setResultBalance(observed balance)` (or the
   rejection already stored), enqueue `WagerTransactionProcessed`, and enqueue
   `WalletBalanceChanged` **only when a movement occurred**.

**G1 unique-violation retry + `resolveDuplicate`:** if any insert violates a unique
constraint (concurrent duplicate submit, concurrent same-type reversal), the aborted tx
rolls back everything; `execute` retries `runInTx` once in a fresh transaction. If the
retry also hits a unique violation, `resolveDuplicate` runs a **read-only** tx that
classifies: by key → replay or 409; by external id → 409; reference already reversed →
`ReferenceResolutionError` (422 `REFERENCE_ALREADY_REVERSED`); else the original error
rethrows. Result: races answer 409/422, never 500.

**Domain collaborators:** `WagerTransaction` (state machine:
`PENDING → PROCESSED | REJECTED | PENDING_REFERENCE`, `markProcessed`/`reject`/
`markPendingReference`, `assertNotTerminal`), `Wallet.debit/credit` (immutable
value-style, returns `{movement, wallet}`), `Money` (decimal.js, never `number`),
`WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, `payloadHash` (SHA-256 over
canonical ASCII-sorted JSON of the 10 business fields), `isUniqueViolation`.

**Idempotency identity:** `uq_wager_tx_idempotency_key` (global, **not yet
provider-scoped** — see Deferred) + `uq_wager_tx_provider_external`.

## Invariants and Guarantees

1. **Exactly-once effects per `Idempotency-Key`** — one stored `wager_transaction`, one
   ledger entry, one wallet version bump; replays return the stored outcome (success,
   rejection, or pending) with `idempotentReplay: true` and the **original** balance
   snapshot (AC-5/AC-12; 50× flood is a Phase 5 test).
2. **Same key + different payload ⇒ 409**, stored result untouched (AC-6). Same
   `(providerId, externalTransactionId)` under a different key ⇒ 409 (CR-5).
3. **One stored transaction per `(providerId, externalTransactionId)`** — DB unique.
4. **Wallet serialization** — `SELECT ... FOR UPDATE` inside the tx; balance can never go
   negative (`ck_wallet_balance_non_negative` + domain check); `wallet.version` increments
   per movement.
5. **422 carries no balance and no movement** (G14); rejections are durable, auditable
   rows with `failureCode` + snapshot, and they replay identically (AC-5a).
6. **Per-type single reversal** — at most one `PROCESSED` reversal of each kind per
   reference; mixed types (REFUND then ROLLBACK on one BET) are allowed (AC-8).
7. **`PENDING` never appears on the wire** — HTTP returns `200 PROCESSED`,
   `202 PENDING_REFERENCE`, or `422 REJECTED` only.
8. **Events are atomic with state** — outbox rows are written in the same transaction;
   `WalletBalanceChanged` only on movement; `WagerTransactionProcessed` on every success
   (including `LOSS`, which writes no ledger entry); `WagerTransactionRejected` on every
   stored rejection; `WagerTransactionPendingReference` when a reference is absent.
9. **Validation precedes persistence** — DTO failures and `Idempotency-Key` shape errors
   return `400` with zero rows written (asserted by SQL row counts in tests).
10. **EM/DI discipline** — root EM as transaction factory only; repositories per
    transaction; reads in short transactions (pinned); `allowGlobalContext: false`.
11. **Provider isolation on reads** — provider-scoped lookup never reveals another
    provider's transaction (AC-20). *(The by-UUID lookup is currently unscoped — see
    Deferred.)*

## Error Mapping

| Condition | HTTP | `code` / body | Notes |
|---|---|---|---|
| `PROCESSED` (incl. `LOSS`) | `200` | `{transactionId, status, balance, idempotentReplay}` | `LOSS` keeps the balance |
| `PENDING_REFERENCE` (reference not yet present) | `202` | `{transactionId, status, idempotentReplay}` | exactly 3 keys, no balance (G5) |
| Business rejection: `INSUFFICIENT_FUNDS`, `REVERSAL_EXCEEDS_BALANCE`, `CURRENCY_MISMATCH`, `WALLET_NOT_FOUND`, `REFERENCE_MISMATCH`, `REFERENCE_INVALID_KIND`, `REFERENCE_AMOUNT_MISMATCH`, `REFERENCE_NOT_PROCESSED`, `REFERENCE_ALREADY_REVERSED` (`REFERENCE_NOT_FOUND` once the Phase 7 worker lands) | `422` | `TRANSACTION_REJECTED` + `status: "REJECTED"` + `failureCode` + `transactionId` + `idempotentReplay` | **no `balance`** (G14); message `Transaction rejected: <failureCode>` |
| Missing / blank / whitespace-only / >255-char / comma-bearing `Idempotency-Key` | `400` | `VALIDATION_ERROR`, `errors[0].property = "idempotency-key"` | pre-write; nothing persisted (AC-19, CR-6) |
| DTO violation: unknown fields, bad UUIDs, `kind: OPENING`, missing `money`, missing reference for `REFUND`/`ROLLBACK`, id > 255 chars, bad money format | `400` | `VALIDATION_ERROR`, `message: "Validation failed"`, `errors: [{property, constraints}]` dotted (`money.amount`) with non-empty constraints | AC-18 (HTTP), AC-24, CR-1, IM-6 |
| Same key, different payload | `409` | `IDEMPOTENCY_CONFLICT` | no `failureCode` |
| Same `(providerId, externalTransactionId)` under a different key | `409` | `IDEMPOTENCY_CONFLICT` | pre-check (step 3) and post-retry (`resolveDuplicate`) |
| Unknown `transactionId`, unknown provider+external, **foreign provider** | `404` | `NOT_FOUND` | no `failureCode` |
| Malformed `:transactionId` | `400` | `VALIDATION_ERROR` | `ParseUUIDPipe` |
| Transient infra (PG/SQS unreachable, `ECONNREFUSED`, timeouts) | `503` | `SERVICE_UNAVAILABLE` + `failureCode: INFRASTRUCTURE_ERROR` + `Retry-After: 5` | safe to retry with the same key |
| Unexpected error | `500` | `INTERNAL_ERROR` | message masked, `errors` dropped |
| Missing/invalid token or JWKS failure | `401` | `UNAUTHORIZED` | global `JwtGuard` (`src/auth/jwt.guard.ts`), fail-closed — since T044 (Phase 8) |
| Valid token, missing realm role | `403` | `ROLE_FORBIDDEN` | global `RolesGuard` (`src/auth/roles.guard.ts`), fail-closed — since T044 (Phase 8) |

Domain errors reaching the filter map as: `ValidationError → 400`,
`IdempotencyConflictError → 409`, `NotFoundError → 404` (no failureCode),
`ReferenceResolutionError`/other `DomainError` with a failure code → `422`
(`failureCode` preserved), `failureCode === INFRASTRUCTURE_ERROR → 503`.

## Events

Enqueued as `outbox_message` rows in the **same SQL transaction** as the state change
(Transactional Outbox; published to `wager-transactions.fifo` since Phase 7 by
`src/workers/outbox-publisher.worker.ts`, at-least-once):

| Event (`eventType`, version 1) | When | Aggregate / key payload |
|---|---|---|
| `WagerTransactionProcessed` | every `PROCESSED` submit (incl. `LOSS`) | `aggregateId = transactionId`; `walletId`, `kind`, `money`, `balanceBefore`, `balanceAfter`, `walletVersion` |
| `WagerTransactionRejected` | every stored rejection (422 path) | `aggregateId = transactionId`; `failureCode`, `walletId`, `kind`, `money` |
| `WagerTransactionPendingReference` | `REFUND`/`ROLLBACK` whose reference does not exist yet | `transactionId`, `referenceExternalTransactionId`, `kind`, `money` |
| `WalletBalanceChanged` | **only when a ledger movement occurred** (never for `LOSS`, never for rejections/pending) | `aggregateId = walletId`; `direction`, `money`, `balanceBefore/After`, `walletVersion` |

The wallets module emits `WalletBalanceChanged` for the `OPENING` balance on wallet
creation. This module emits no direct notifications (no `NotificationsModule` in this
repo).

## External Integrations

- **No direct external calls from this module.** The use case accepts an
  `ingress.kind: 'sqs'` command shape and the inbox table/dedup step live here, but
  the SQS plumbing belongs to `src/messaging/` (Phase 6: `sqs.client.ts`,
  `wager-transaction.consumer.ts`, `messaging.module.ts`), outbound events go
  through `src/workers/outbox-publisher.worker.ts` (Phase 7), and HTTP callers
  authenticate via Keycloak (`src/auth/`, Phase 8). The AWS SDK
  (`@aws-sdk/client-sqs`) is a declared dependency but remains unused *inside this
  module*.

## Dependencies

**Imports (declared in `@Module`):** none.

**Providers:** `SubmitTransactionUseCase`, `WageringService`; **Controller:**
`WageringController`.

**Exports:** `SubmitTransactionUseCase` — since Phase 6,
`MessagingModule` (`src/messaging/messaging.module.ts`) imports this module and
hands the use case to the SQS consumer. The Phase 7 workers (`src/workers/`) do
**not** import this module; they work through `src/database/repositories/`
directly.

**Implicit/global dependencies:** MikroORM root wiring (`AppModule`), global
`ValidationPipe` + `HttpExceptionFilter`, `MoneyDto`, `payloadHash`, `isUniqueViolation`,
domain classes (`WagerTransaction`, `Wallet`, `Money`, errors/failure codes), event
classes in `src/events/`, repositories in `src/database/repositories/`.

**Sibling relationship:** `WageringModule` does **not** import `WalletsModule`; tests seed
wallets by constructing `WalletsService` with an EM directly.

## Testing

| File | What it proves |
|---|---|
| `tests/integration/submit-transaction.use-case.spec.ts` (27 tests) | The core flow against real PG. **Cycle A (happy path):** BET debits + ledger + `result_balance` + `payload_hash` + `WagerTransactionProcessed` **and** `WalletBalanceChanged` with `walletVersion 2`; WIN credits; LOSS processes with **no** balance change, **no** ledger entry, **no** `WalletBalanceChanged` but still `WagerTransactionProcessed`; unique provider/external/idempotency fields stored. **Cycle B (stored rejections):** `INSUFFICIENT_FUNDS` → `REJECTED` row, no effects, rejected event only; `CURRENCY_MISMATCH` even for a non-moving kind (snapshot keeps wallet currency); `WALLET_NOT_FOUND` with **null** `result_balance` + rejected event. **Cycle C (references):** REFUND of BET credits and links `reference_transaction_id`; second same-type REFUND ⇒ `REFERENCE_ALREADY_REVERSED`; mixed-type ROLLBACK after REFUND allowed; second ROLLBACK rejected; REFUND of WIN ⇒ `REFERENCE_INVALID_KIND`; absent reference ⇒ `PENDING_REFERENCE` row + snapshot + `WagerTransactionPendingReference` (no ledger change); cross-round reference ⇒ `REFERENCE_MISMATCH`; reversal debiting past zero ⇒ `REVERSAL_EXCEEDS_BALANCE` with no entry; forced same-reference race (protocol-patched `findAppliedReversal`) ⇒ `ReferenceResolutionError` not 500 (IM-3). **Cycle D (idempotency):** replay of success/rejection/pending with original balance and **zero** new effects (version/ledger/row counts asserted); same key + different payload ⇒ `IdempotencyConflictError`; forced G1 race (patched `findByIdempotencyKey`) resolves to a replay with one row and one debit; SQS-ingress duplicate `messageId` dedups via exactly one `inbox_message` row; external id reused under another key ⇒ `IdempotencyConflictError` (CR-5); T046
asserts that an idempotent replay increments `wagering_duplicates_total`. |
| `tests/integration/wagering.http.spec.ts` (23 tests) | HTTP contract of submit + lookups, authenticated with operator bearer tokens since T048 (`tests/helpers/keycloak-token.ts`). `200` §9 body for BET; missing / empty / whitespace `Idempotency-Key` ⇒ 400 **and zero new rows** (AC-19); `kind: OPENING` ⇒ 400 (AC-18 HTTP); every invalid field aggregated in `errors[]` with non-empty constraints (AC-24); missing `money` ⇒ 400 not 500 (CR-1); missing reference for `REFUND`/`ROLLBACK` ⇒ 400; 300-char `providerId` ⇒ 400 (IM-6); comma-bearing key ⇒ 400 (CR-6); external id under a different key ⇒ 409 with no extra row (CR-5); unknown payload fields ⇒ 400; `422` pinned body (`code/status/failureCode/transactionId/idempotentReplay`, no `balance`) (G14, AC-5a); replay of success ⇒ `idempotentReplay: true` + original balance; same key + different payload ⇒ 409; replay of rejection ⇒ byte-identical 422 with `idempotentReplay: true`; `202` pending with exactly 3 keys and its replay (AC-25, G5); GET by id for `PROCESSED` / `REJECTED` (failureCode + balance) / `PENDING_REFERENCE` (no balance) bodies (AC-28); unknown id 404 / malformed 400; provider-scoped lookup resolves own provider and 404s a foreign provider (AC-20). |
| `tests/integration/http-api.spec.ts` (8 e2e scenarios) | The full §9 walk over real PG (T029): wallet lifecycle (create `version 1` → duplicate 409 → other currency 201); `BET/WIN/LOSS` balance + direction arithmetic and ledger contents; insufficient funds ⇒ 422 with unchanged balance/ledger; idempotent replay with original balance + 409 conflict (AC-5); refund once / second refund 422 `REFERENCE_ALREADY_REVERSED` / mixed ROLLBACK allowed / second ROLLBACK 422 (AC-8); cross-currency submit ⇒ 422 `CURRENCY_MISMATCH`, no effects, read-back keeps **wallet** currency (CR-2); `OPENING` externally ⇒ 400 (AC-18) and reconciliation consistent (AC-17); `limit=1` ledger walk with no duplicates/skips and newest-first order (AC-21). |
| `tests/integration/bootstrap.spec.ts` (6) | Global pipe/filter wiring, the generic `404 NOT_FOUND` contract this module's lookups rely on, plus the correlation-id middleware (T045) and readiness `{postgres, sqs}` body (T047). |
| `tests/unit/common/http/exception.filter.spec.ts` (38) | The pinned error contract end-to-end: domain→status mapping (`ValidationError→400`, `IdempotencyConflictError→409`, `WalletExistsError→409`, `NotFoundError→404` w/o failureCode, business reject→422 + failureCode), 422 passthrough of `transactionId`/`idempotentReplay`, `Retry-After` + `INFRASTRUCTURE_ERROR` on 503, 500 masking, correlation-id validation, header-safe logging. |
| `tests/concurrency/hot-wallet.spec.ts` (1) | Hot-wallet contention: seed wallet `100.00`; `Promise.all` two `POST /wagering/transactions` bets of `80.00` (distinct idempotency keys); assert one `PROCESSED`, one `REJECTED INSUFFICIENT_FUNDS`, balance `20.00`, exactly one `DEBIT` row in ledger (AC-11). |
| `tests/concurrency/duplicate-flood.spec.ts` (1) | 50× duplicate flood: same idempotency key + payload fired 50× in parallel → exactly one stored transaction, one debit, all responses consistent (`idempotentReplay: true` on ≥49) (AC-12). |
| `tests/concurrency/multi-instance.spec.ts` (1) | Multi-instance: 3 logical app instances (spawned via test helper on ports 3001–3003, same DB/queues); mixed workload across shared + distinct wallets; final invariant check: for every wallet `balance == Σledger` and no duplicate debit per transaction. |

Supporting (shared): `tests/integration/schema.spec.ts` (25) proves the DB constraints
this module depends on — unique idempotency key, unique provider+external, partial
`uq_wager_tx_reference_kind` (rejects second same-kind reversal, accepts mixed kinds),
non-negative balance CHECK, ledger immutability trigger.

## Not Yet / Deferred

**Planned — explicitly not implemented today:**

- **Auth residual gap (the guards themselves — T044 — are live):** the Phase 8
  tokens carry no `providerId`, so `GET /wagering/transactions/:transactionId`
  stays readable by any `transact:read` holder who knows the UUID; `401`/`403` are
  live paths asserted in `tests/integration/auth-observability.spec.ts` (the HTTP
  suites now send operator bearer tokens).
- **Metrics / observability (T045/T046, Phase 8 — completed):**
  `wageringLockConflictsTotal`, `wageringTxTotal{processed,rejected,pendingReference}`,
  `wageringProcessingSeconds`, `wageringDuplicatesTotal`,
  `wageringSqsRetriesTotal`, `wageringDlqReceivedTotal`, `wagering_outbox_lag`
  and `wagering_reconciliation_divergences_total` are `prom-client` instruments in
  `src/observability/metrics.service.ts` (re-exported by
  `src/common/metrics/metrics.ts`, so call sites are unchanged), rendered at
  `GET /metrics`; pino logging + correlation middleware (T045) are wired in
  `src/main.ts` / `src/observability/`.
- **SQS consumer (T034–T037, Phase 6 — completed):** `src/messaging/` provides
  `sqs.client.ts`, `wager-transaction.consumer.ts`, `messaging.module.ts`, the
  idempotent `bun run queue:setup` script, DLQ forwarding, and
  ack-after-commit / SIGTERM drain behavior; the consumer invokes
  `SubmitTransactionUseCase.execute` with `ingress.kind: 'sqs'` (inbox dedup as
  step 1) — covered by `tests/integration/sqs-ingress.spec.ts`.
- **Workers (Phase 7 — completed):** outbox publisher
  (`src/workers/outbox-publisher.worker.ts`, T038) publishes outbox rows
  post-commit; the pending-reference worker (`src/workers/pending-reference.worker.ts`,
  T040) resolves or exhausts `PENDING_REFERENCE` rows with backoff/TTL
  (`reference_attempts` / `reference_next_attempt_at` from migration 001).
- **Concurrency suites (T030–T032, Phase 5):** **completed** — hot-wallet
  (`tests/concurrency/hot-wallet.spec.ts`), 50× duplicate-flood
  (`tests/concurrency/duplicate-flood.spec.ts`), and 3-instance
  (`tests/concurrency/multi-instance.spec.ts`) tests exist and pass; the `FOR UPDATE` +
  unique-constraint guarantees are proven under real parallelism.
- **Idempotency-key scoping migration `(provider_id, key)` (deferred; revisit with
  T039 review):** today `uq_wager_tx_idempotency_key` is global, so one provider
  could squat another's key; requires tokens that bind `providerId` — Phase 8
  landed (T043/T044) **without** a provider claim, so this stays blocked.
- **Provider-scoping of `GET /wagering/transactions/:transactionId` (deferred):**
  any `transact:read` caller holding the UUID can read it — the Phase 8 guard
  design deliberately checked roles only; still an open question.
- **Performance (deferred; candidates from the completed T039 review):** ~11 SQL round trips inside
  the `FOR UPDATE` window (each `save()` = `findOne` + `flush`) → single-flush
  optimization; `pageByCursor` `$or` → row-value predicate.
- **Structural refactor (deferred; now unblocked):** `submit-transaction.use-case.ts` (~460 lines)
  duplicates the idempotency/external lookup logic between `runInTx` and
  `resolveDuplicate` — was to happen after Phase 7 workers land; Phases 6–7 are
  complete, so nothing blocks it now.

## Safe Change Checklist for Future AI Work

1. Any change to the submit pipeline order (inbox → idempotency → external-id → lock →
   currency → reference → movement → events) must keep **one transaction** per attempt
   and the G1 retry + `resolveDuplicate` classification in
   `submit-transaction.use-case.ts`; update
   `tests/integration/submit-transaction.use-case.spec.ts` cycles A–D together.
2. Never return `balance` on a `422` (G14) or on `202` (G5) — controller shapes and
   `wagering.http.spec.ts` key-set assertions enforce this; changing it is a contract
   break.
3. New `failureCode` ⇒ add to `src/domain/failure-codes.ts` (+ descriptions), the
   `reject(...)` call site, the 422 table in this doc, and the HTTP/use-case specs; verify
   the filter still passes `failureCode` through only for 422/503.
4. DTO/header rule changes touch `dto/submit-transaction.dto.ts` **and**
   `assertIdempotencyKey` in `wagering.controller.ts` **and** `wagering.http.spec.ts`
   together (header rules live in the controller, body rules in the DTO).
5. Reversal-rule changes (allowed reference kinds, per-type single reversal) must satisfy
   both the application check (`findAppliedReversal`) **and** the partial unique index
   `uq_wager_tx_reference_kind` — schema changes go through the MikroORM migration
   atomic chain (`bun run mikro-orm migration:create` → drift check → run locally),
   never hand-written SQL files.
6. The SQS consumer (`src/messaging/wager-transaction.consumer.ts`, Phase 6) must keep
   calling `SubmitTransactionUseCase.execute` with
   `ingress: { kind: 'sqs', messageId, consumerName }` and delete the message only after
   commit — do not fork the business logic; keep inbox dedup as step 1.
7. Do not introduce a global EM or repository singleton (`allowGlobalContext: false`);
   keep repositories constructed inside `em.transactional`.
8. Verify with `bun run validate` (`tsc --noEmit`), then `bun test` (integration suites
   need the full compose stack: PostgreSQL + LocalStack + Keycloak **with the
   `wagering` realm imported** — token suites fetch real JWTs). Baseline
   2026-10-09 (Phase 8): `bun run validate` exit 0; unit 249 pass / 0 fail; all
   integration suites green run individually; concurrency 3 pass / 0 fail.
