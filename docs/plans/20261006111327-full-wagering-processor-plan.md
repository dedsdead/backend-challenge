---
title: "Full Wagering Processor — Execution Plan"
type: enhancement
status: active
date: 2026-10-06
phased: true
---

# Full Wagering Processor — Execution Plan

Source brainstorm: [`docs/brainstorms/20261006110158-full-wagering-processor-brainstorm.md`](../brainstorms/20261006110158-full-wagering-processor-brainstorm.md)
Spec: [`README.md`](../../README.md) (sections referenced as §N)

## Overview

**Problem/Motivation:** Build the complete Jungle Gaming technical challenge: a
distributed wagering processor that accepts provider operations
(`BET → WIN | LOSS | REFUND | ROLLBACK`) over HTTP and SQS, applies them to player
wallets with an immutable audit ledger, and stays correct under duplicated,
out-of-order, and concurrent delivery across 3+ instances.

**What we're building:** a single NestJS (Bun) service with dual ingress funneling
into one use case, persistent idempotency (inbox + unique constraints), transactional
outbox for events, scheduled workers for out-of-order references, Keycloak-protected
HTTP API, and the full §13 test suite (unit, integration, concurrency).

**Who it's for:** game providers (API/queue clients), operators (reconciliation,
DLQ/outbox health), evaluators (§14 rubric). No UI in scope.

## Scope / Work Breakdown

| Group | Requirements | Phase |
|---|---|---|
| G1 Foundation & local stack | Bun+NestJS scaffold, strict TS, MikroORM wiring, docker-compose (PostgreSQL+LocalStack+Keycloak), config, health, logging base | 1 |
| G2 Domain model & events | `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, `IntegrationEvent` envelope, enums, failure codes, unit tests (§6, §11, §13) | 2 |
| G3 Persistence & schema | MikroORM entities, migration 001 with DB-enforced constraints (§5.9), repositories, schema tests | 3 |
| G4 Use case + HTTP API | atomic submit (idempotency, lock, ledger, outbox), wallet CRUD, queries, reconciliation, status mapping (§7, §9) | 4 |
| G5 Concurrency correctness | §8 hot-wallet scenario, 50× duplicate submit, ≥3 instances, lock metrics | 5 |
| G6 SQS ingress | consumer, inbox dedup, ack-after-commit, error classification, DLQ, SIGTERM (§10) | 6 |
| G7 Events & out-of-order workers | outbox publisher (SKIP LOCKED claim), `PENDING_REFERENCE` reprocessor, backoff/limits (§7.1, §11) | 7 |
| G8 Auth & observability | Keycloak realm + OIDC guard, structured logs, metrics, readiness (§2, §12) | 8 |
| G9 Verification & graded docs | §13 resilience suite, README setup/commands, root `ARCHITECTURE.md`, foundation docs sync | 9 |

## Proposed Solution

Decisions come from the brainstorm (✅ items) plus the ⚠️ OPEN items resolved here:

- **Architecture:** single NestJS service; HTTP controller + SQS consumer both call
  `SubmitTransactionUseCase`. One SQL transaction = wallet lock + balance + ledger +
  inbox dedup + outbox rows. Domain classes are pure (no ORM/Nest decorators);
  persistence entities live in `src/database/entities/` with mappers (spec §6.1).
- **Concurrency:** pessimistic row lock — inside
  `em.transactional(async em => em.findOne(WalletEntity, id, { lockMode: LockMode.PESSIMISTIC_WRITE }))`
  (verified: requires open transaction, emits `FOR UPDATE`). `version` increments on
  every balance change for observability.
- **Data model (5 tables):** `wallet` (UNIQUE(player_id, currency), CHECK
  balance >= 0, numeric(20,2) amount + char(3) currency), `wager_transaction`
  (UNIQUE(idempotency_key), UNIQUE(provider_id, external_transaction_id), partial
  UNIQUE(reference_transaction_id, kind) WHERE status = 'PROCESSED' as the per-type
  reversal backstop (§7.4, clarified 2026-10-06), nullable
  `result_balance_amount/currency` snapshot for §7.7 replay),
  `wallet_ledger_entry` (immutable via `BEFORE UPDATE OR DELETE` trigger that raises
  an exception), `inbox_message` (UNIQUE(consumer_name, message_id)),
  `outbox_message` (+ index for due/pending rows). Enums as native PG enums.
- **Decided now (brainstorm ⚠️ items):**
  1. **Local broker = LocalStack** (`SERVICES=sqs`), FIFO + redrive configured by
     `scripts/create-queues.ts`.
  2. **`failureCode` taxonomy** (in `src/domain/failure-codes.ts`):
     `INSUFFICIENT_FUNDS`, `REVERSAL_EXCEEDS_BALANCE`, `REFERENCE_NOT_FOUND`,
     `REFERENCE_INVALID_KIND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_MISMATCH`,
     `CURRENCY_MISMATCH`, `WALLET_NOT_FOUND`, `VALIDATION_FAILED`,
     `INFRASTRUCTURE_ERROR`.
  3. **`PENDING_REFERENCE` limits:** max 10 attempts, backoff
     `min(2^attempts * 30s, 30min)`, TTL 24h → terminal `REJECTED` +
     `REFERENCE_NOT_FOUND` + `WagerTransactionRejected` event.
  4. **HTTP status mapping** — one `code` per failure class:
     - **200** `OK`: success (`PROCESSED`) with the §9 body
     - **201**: wallet created (`POST /wallets`)
     - **400** `VALIDATION_ERROR`: invalid payload (including missing
       `Idempotency-Key` and `kind: "OPENING"`)
     - **401** `UNAUTHORIZED`: missing/invalid token (fail-closed on JWKS errors)
     - **403** `ROLE_FORBIDDEN`: authenticated but missing the required role
     - **404** `NOT_FOUND`: unknown transaction/wallet on **read** endpoints (a
       wallet miss on submit is a business rejection → **422** +
       `failureCode: WALLET_NOT_FOUND`)
     - **409** `IDEMPOTENCY_CONFLICT` / `WALLET_EXISTS`: idempotency conflict /
       duplicate wallet
     - **422** `TRANSACTION_REJECTED` + `failureCode` + `transactionId`: business
       rejection
     - **202** `status: PENDING_REFERENCE`: accepted-pending (`PENDING` is an
       internal in-flight enum value and **never returned** by HTTP — clarified
       2026-10-06)
     - **503** `SERVICE_UNAVAILABLE` + `Retry-After`: transient infrastructure failure
     - Replays (success **or** error) repeat the original response with
       `idempotentReplay: true` and the balance observed at original processing
       (§7.7, stored as `result_balance_*` on the transaction row).
  5. **`payloadHash`:** SHA-256 hex of canonical JSON (recursively ASCII-sorted keys,
     no whitespace) over business fields only:
     `providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind,
     money.amount, money.currency`. Algorithm documented in README.
  6. **Money storage:** `numeric(20,2)` + `currency char(3)`; domain uses `decimal.js`
     internally (never `number`).
  7. **Event envelope (§11):** abstract `IntegrationEvent<T>` base + four concrete
     subclasses, each with `eventType` and `version = 1` **on the type**;
     `data` carries `MoneyProps` strings only.
  8. **Root `ARCHITECTURE.md`:** graded artifact = decisions/trade-offs summary that
     links to `docs/architecture.md` as full source of truth (kept in sync at Phase 9).

## Technical Considerations

- **Rules in force:** `.opencode/AGENTS.md` — validate with `bun run validate`
  (`tsc --noEmit`), **never auto-run build**; commits need `[TICKET-XXXX]` prefix
  (ask user for ticket before any commit; no auto-commit per
  `docs/workflow/operational-overrides.md`); user-facing text in English; docs scope
  = this repo's `./docs`.
- **Conventions:** `nestjs-conventions` skill — thin controllers, services orchestrate,
  class-validator DTOs (`whitelist`, `forbidNonWhitelisted`), global exception filter,
  feature modules under `src/modules/`.
- **Learnings:** `docs/solutions/` is empty; `docs/solutions/patterns/critical-patterns.md`
  does not exist — no prior patterns to follow.
- **Migration safety:** greenfield — migration 001 creates everything (no
  zero-downtime/backfill concerns, no `CONCURRENTLY` needed on empty tables).
  **Atomic chain required: generate via MikroORM CLI → drift-check → run locally
  IMMEDIATELY** (never defer the local run; there is no TypeORM/Prisma skill for
  MikroORM — apply the same discipline). Same chain for migration 002 in Phase 7.
- **MikroORM gotchas:** pessimistic lock throws unless inside `em.transactional`;
  the wallet row must be fetched **inside** the transaction with the transactional
  `em` (managed entity). Outbox claim uses raw `em.execute()` with
  `FOR UPDATE SKIP LOCKED`.
- **Security:** OIDC JWT via JWKS (issuer/audience from env) — never hand-rolled
  users; secrets only via env (`.env` gitignored); parameterized queries only; logs
  redact payloads; health endpoints and `GET /metrics` `@Public()`; queue payloads
  fully domain-validated (including `kind !== "OPENING"`).
- **Tests required by project rules** (spec §13): unit, integration against real
  PostgreSQL + LocalStack containers (mocks alone are eliminatory), real-parallel
  concurrency tests. Runner: `bun test`.
- **Performance:** keyset cursor pagination (never OFFSET) on ledger; indexed
  idempotency/inbox/outbox lookups; outbox batches capped at 50; per-wallet lock is
  intentional serialization (unit = `walletId`).

## Acceptance Criteria

#### AC-1: Provider creates wallet
**Given** an authenticated provider client **When** `POST /wallets` with
`playerId` and `initialBalance {amount:"1000.00", currency:"BRL"}` **Then** 201 with
`id`, `balance`, `version: 1`, and one `OPENING` transaction + `CREDIT` ledger entry
exist in the same DB transaction.
**Roles:** Provider · **Priority:** Must-have

#### AC-2: Duplicate wallet rejected
**Given** a wallet exists for `playerId` + `BRL` **When** `POST /wallets` repeats it
**Then** 409 `WALLET_EXISTS`, no second wallet row.
**Roles:** Provider · **Priority:** Must-have

#### AC-3: BET succeeds
**Given** a wallet with `1000.00 BRL` **When** a valid `BET 25.00` is submitted with
`Idempotency-Key` **Then** 200 with `status: PROCESSED`, balance `975.00`, exactly
one `DEBIT` ledger entry, `WalletBalanceChanged` enqueued in outbox.
**Roles:** Provider · **Priority:** Must-have

#### AC-4: BET with insufficient funds
**Given** balance `20.00` **When** `BET 80.00` **Then** 422,
`status: REJECTED`, `failureCode: INSUFFICIENT_FUNDS`, balance unchanged, **no**
ledger entry.
**Roles:** Provider · **Priority:** Must-have

#### AC-5: Idempotent replay
**Given** a processed transaction under key K **When** the identical request is sent
again with K **Then** the original response is returned with
`idempotentReplay: true` and the balance observed at original processing; no new
balance change, ledger entry, or event.
**Roles:** Provider · **Priority:** Must-have

#### AC-6: Same key, different payload = conflict
**Given** key K used with payload A **When** K is reused with payload B **Then** 409
`IDEMPOTENCY_CONFLICT` (not a replay), stored result unchanged.
**Roles:** Provider · **Priority:** Must-have

#### AC-7: WIN credits and LOSS does not move balance
**Given** a processed `BET` **When** `WIN 40.00` (same round) is processed **Then**
balance +40.00 with one `CREDIT`; **When** `LOSS` is processed **Then** balance
unchanged, **zero** ledger entries, `WagerTransactionProcessed` still emitted.
**Roles:** Provider · **Priority:** Must-have

#### AC-8: REFUND once, second refund rejected
**Given** a `PROCESSED` `BET` **When** `REFUND` referencing it succeeds **When** a
second `REFUND` references the same `BET` **Then** second is `REJECTED` with
`REFERENCE_ALREADY_REVERSED`, one reversal ledger entry total.
**Roles:** Provider · **Priority:** Must-have

#### AC-9: Out-of-order reference resolves
**Given** no `BET` yet **When** `ROLLBACK` referencing `transaction-123` arrives
**Then** it persists as `PENDING_REFERENCE` with `WagerTransactionPendingReference`
emitted; **When** the `BET` arrives and the reprocessor runs **Then** the rollback
applies (inverted ledger entry) and status becomes `PROCESSED`.
**Roles:** Provider · **Priority:** Must-have

#### AC-10: Missing reference exhausts retries
**Given** a `PENDING_REFERENCE` transaction past 10 attempts / 24h TTL **When** the
reprocessor runs **Then** status `REJECTED`, `failureCode: REFERENCE_NOT_FOUND`,
`WagerTransactionRejected` emitted; stays auditable.
**Roles:** Provider/Operator · **Priority:** Must-have

#### AC-11: §8 hot-wallet scenario
**Given** balance `100.00` **When** two `80.00` bets are processed simultaneously
**Then** exactly one `PROCESSED`, one `REJECTED` (`INSUFFICIENT_FUNDS`), balance
`20.00`, exactly one `DEBIT` ledger entry; repeated retries never duplicate it.
**Roles:** Provider · **Priority:** Must-have

#### AC-12: 50× parallel duplicate submit
**Given** one idempotency key **When** the same request is sent 50× in parallel
**Then** exactly one debit and one stored transaction exist.
**Roles:** Provider · **Priority:** Must-have

#### AC-13: SQS duplicate delivery has single effect
**Given** the same queue message (same `messageId`) is delivered twice **When** the
consumer processes both **Then** inbox unique key absorbs the second — one effect,
both messages acknowledged after commit.
**Roles:** Provider (queue) · **Priority:** Must-have

#### AC-14: Poison message reaches DLQ
**Given** a message that fails permanent validation (incl. `kind: "OPENING"` or
missing fields) **When** redrive limit (5 receives) is exceeded **Then** the message
lands in `wager-transactions-dlq.fifo`; app stays healthy.
**Roles:** Operator · **Priority:** Must-have

#### AC-15: Crash between commit and publish
**Given** a transaction committed with an unpublished outbox row **When** the process
dies and another instance runs the publisher **Then** the event is published
(at-least-once) and consumers stay correct on duplicate publish.
**Roles:** Operator · **Priority:** Must-have

#### AC-16: Auth boundary
**Given** no/invalid token **When** calling any non-public business endpoint
**Then** 401 `UNAUTHORIZED`; **Given** a valid token missing the required role
**When** calling that endpoint **Then** 403 `ROLE_FORBIDDEN`; `/health/*` and
`GET /metrics` are the only `@Public` endpoints and always work without a token
(T007/T046).
**Roles:** Unauthenticated / Provider · **Priority:** Must-have

#### AC-17: Reconciliation
**Given** ledger entries exist **When** `POST /wallets/:walletId/reconciliation`
**Then** response reports `storedBalance`, `calculatedBalance`, `difference`,
`consistent`, `checkedEntries`; a seeded divergence is logged, counted in metrics,
and flagged `consistent: false` — never auto-corrected.
**Roles:** Operator · **Priority:** Must-have

#### AC-18: OPENING cannot be submitted externally
**Given** the API **When** a payload with `kind: "OPENING"` arrives **Then**
400 `VALIDATION_ERROR`; **Given** the queue **When** such a message arrives **Then**
it is classified permanent and ends in the DLQ — only internal wallet creation may
create `OPENING`.
**Roles:** Provider · **Priority:** Must-have

## Implementation Plan

| Phase | Name | Depends On | Status |
|-------|------|------------|--------|
| 1 | Foundation & Local Stack | None | ✅ Completed |
| 2 | Domain Core & Events | Phase 1 | ⬜ Pending |
| 3 | Persistence & Schema | Phase 2 | ⬜ Pending |
| 4 | Use Case & HTTP API | Phase 3 | ⬜ Pending |
| 5 | Concurrency Hardening | Phase 4 | ⬜ Pending |
| 6 | SQS Ingestion | Phase 4 | ⬜ Pending |
| 7 | Outbox & Reference Workers | Phase 6 | ⬜ Pending |
| 8 | Auth & Observability | Phase 4 | ⬜ Pending |
| 9 | Resilience Suite & Graded Docs | Phases 5–8 | ⬜ Pending |

---

### Phase 1: Foundation & Local Stack

**Status**: ✅ Completed
**Objective**: Runnable NestJS-on-Bun service with strict TypeScript, dockerized
PostgreSQL/LocalStack/Keycloak, config, and health endpoints.
**Dependencies**: None

**Tasks**:

- [x] T001 [US1] Scaffold project at repo root
  - `package.json` scripts: `dev: bun run src/main.ts`, `validate: tsc --noEmit`,
    `test: bun test`, `test:unit: bun test tests/unit`,
    `test:integration: bun test tests/integration`,
    `test:concurrency: bun test tests/concurrency`,
    `mikro-orm: mikro-orm`
  - deps: `@nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
    @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations
    class-validator class-transformer decimal.js pino pino-http
    @aws-sdk/client-sqs prom-client`
  - devDeps: `typescript @types/node @types/bun`
- [x] T002 [US1] Create `tsconfig.json`
  - `"strict": true`, `"noUncheckedIndexedAccess": true`,
    `"experimentalDecorators": true`, `"emitDecoratorMetadata": true`,
    `"target": "ES2022"`, `"module": "commonjs"`, `"moduleResolution": "node"`,
    `"outDir": "dist"`, `"rootDir": "."`, include `src/**/*.ts`, `tests/**/*.ts`
  - ⚠ deviated: `module: esnext` + `moduleResolution: bundler` + `types: ["bun"]`
    (node16 → TS1479 + `bun:test` resolution failure) → see Execution Log
- [x] T003 [US1] Create `docker-compose.yml`
  - services: `postgres` (postgres:16, env `POSTGRES_PASSWORD=local`, port 5432,
    healthcheck `pg_isready`), `localstack` (localstack/localstack:latest,
    `SERVICES=sqs`, port 4566, volume `/var/lib/localstack`), `keycloak`
    (quay.io/keycloak/keycloak:26 `start-dev --import-realm`, port 8080,
    healthcheck on `/realms/master`, volume `./keycloak/realm-export.json`)
  - ⚠ deviated: images pinned `localstack/localstack:4.13.1` + `keycloak:26.8`
    (tag `26` does not exist; newer LocalStack needs `LOCALSTACK_AUTH_TOKEN`);
    ports bound to `127.0.0.1` only → see Execution Log
  - healthchecks on all three; no app container (app runs via Bun on host)
- [x] T004 [US1] Create `src/main.ts`
  - `NestFactory.create(AppModule, { bufferLogs: true })`; global
    `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`;
    global `HttpExceptionFilter`; `app.enableShutdownHooks()`; listen `PORT` (default
    3000)
  - ⚠ deviated (review round 2): pipe/filter registered in `AppModule` via
    `APP_PIPE`/`APP_FILTER` (so integration tests cover the wiring); `listen(PORT, HOST)`
    with `HOST` default `127.0.0.1` → see Execution Log
- [x] T005 [US1] Create `src/app.module.ts` root module
  - imports: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`,
    `MikroOrmModule.forRootAsync({...autoLoadEntities: true, migrations: { tableName: 'mikro_orm_migrations' }})`,
    `HealthModule`; no domain modules yet
- [x] T006 [US1] Create `src/config/env.validation.ts` + `.env.example` + `.gitignore` entries
  - env schema (class-validator): `DATABASE_URL`, `SQS_ENDPOINT`
    (default `http://localhost:4566`), `SQS_QUEUE_URL`, `SQS_DLQ_URL`,
    `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `PORT`, `LOG_LEVEL`,
    `WORKERS_ENABLED` (default `true`)
  - `.env.example` filled with local values; `.gitignore` adds `.env`,
    `node_modules/`, `dist/`
- [x] T007 [US1] Create `src/health/health.module.ts`, `health.controller.ts`, `health.service.ts`
  - `GET /health/live` → 200 `{ status: "ok" }` (process only)
  - `GET /health/ready` → `SELECT 1` via `em`; 200 `{ postgres: "ok" }` / 503 on
    failure (SQS probe added in Phase 8 readiness task)
  - mark handlers with `@Public()` (guard lands in Phase 8)

**After completing this phase**:
1. TypeScript Validation — `bun run validate`; fix all errors.
2. Build — only when explicitly requested.
3. Update this plan — mark Phase 1 `✅ Completed` in the table.

---

### Phase 2: Domain Core & Events

**Status**: ⬜ Pending
**Objective**: Pure, fully-tested domain model per spec §6 plus the §11 event
envelope — no ORM/Nest imports.
**Dependencies**: Phase 1

**Tasks**:

- [ ] T008 [US2] Create `src/domain/money/money.ts`
  - `private constructor(private readonly value: Decimal, public readonly currency: string)`
  - static `from({amount, currency})`, `zero(currency)`; methods `add`, `subtract`,
    `negate`, `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`,
    `toJSON(): MoneyProps`, `toString()`; private `assertSameCurrency`
  - validation in `from`: reject `NaN`/`Infinity`/scientific notation/empty string/
    scale > 2/negative when entry-contract disallows; enforce scale-2 canonical form
- [ ] T009 [US2] Create `src/domain/enums.ts`
  - `WagerTransactionKind { Opening="OPENING", Bet="BET", Win="WIN", Loss="LOSS",
    Refund="REFUND", Rollback="ROLLBACK" }`,
    `WagerTransactionStatus { Pending, PendingReference, Processed, Rejected, Failed }`
    with spec string values, `LedgerDirection { Debit="DEBIT", Credit="CREDIT" }`
- [ ] T010 [US2] Create `src/domain/failure-codes.ts`
  - `FailureCode` enum with the 10 codes from Proposed Solution + exported
    `FAILURE_CODE_DESCRIPTIONS: Record<FailureCode, string>`
- [ ] T011 [US2] Create `src/domain/errors.ts`
  - classes: `DomainError` (base, carries optional `failureCode`), `ValidationError`,
    `InsufficientFundsError`, `CurrencyMismatchError`,
    `InvalidTransactionStateError`, `ReferenceResolutionError`,
    `IdempotencyConflictError`, `WalletExistsError`, `NotFoundError`
- [ ] T012 [US2] Create `src/domain/wallet/wallet.ts`
  - private ctor; static `open({id, playerId, initialBalance})`, `rehydrate(state)`
  - getters `balance`, `version`, `updatedAt`; methods
    `debit(money, at): LedgerMovement`, `credit(money, at): LedgerMovement` where
    `LedgerMovement = { direction, money, balanceBefore, balanceAfter }`; debit
    throws `InsufficientFundsError` if result < 0; both bump `_version` and
    `_updatedAt`; private `assertSameCurrency`
- [ ] T013 [US2] Create `src/domain/ledger/wallet-ledger-entry.ts`
  - private ctor; static `create(props)` validates
    `balanceBefore ± money === balanceAfter` (throws `ValidationError` otherwise),
    `rehydrate(state)`; `isBalanced()`; no setters, no transition methods
- [ ] T014 [US2] Create `src/domain/wager-transaction/wager-transaction.ts`
  - private ctor; static `create(props)` (created as `PENDING`; requires
    `referenceExternalTransactionId` for `REFUND`/`ROLLBACK`; rejects `OPENING` when
    `source !== "internal"`), `rehydrate(state)`
  - transitions `markProcessed(referenceTransactionId, at)`,
    `markPendingReference()`, `reject(code, at)`, `fail(code, at)` — throw
    `InvalidTransactionStateError` if `isTerminal()`
  - queries `isTerminal`, `affectsBalance` (false for `LOSS`),
    `requiresReference`, `matchesPayload(hash)`,
    `ledgerDirectionFor(reference)` (inverse for `ROLLBACK`)
  - field `resultBalance?: Money` set once per stored outcome (replay snapshot, §7.7)
- [ ] T015 [US2] Create `src/domain/inbox/inbox-message.ts` and `src/domain/outbox/outbox-message.ts`
  - `InboxMessage.receive({messageId, consumerName, payloadHash, receivedAt})`,
    `markProcessed(at)`, `isProcessed()`
  - `OutboxMessage.enqueue(event)`, `markPublished(at)`,
    `scheduleRetry(now)` → `attempts++`,
    `nextAttemptAt = now + min(2^attempts * 1s, 5min)`, `isPending()`, `isDue(now)`
- [ ] T016 [US2] Create event envelope `src/events/`
  - `integration-event.ts`: `abstract class IntegrationEvent<T>` with
    `abstract readonly eventType: string`, `abstract readonly version: number`,
    ctor fields `eventId, aggregateId, correlationId, causationId?, occurredAt,
    data: Readonly<T>`, and `toJSON()` returning
    `{ eventId, eventType, aggregateId, correlationId, causationId?, occurredAt
    (ISO-8601), version, data }`
  - `wager-transaction-processed.event.ts`,
    `wager-transaction-rejected.event.ts`,
    `wallet-balance-changed.event.ts`,
    `wager-transaction-pending-reference.event.ts` — one concrete subclass each,
    `version = 1` on the type, static `from(...)` factories; `data` payloads use
    `MoneyProps` strings only (e.g. `WalletBalanceChangedData { walletId,
    transactionId, direction, money, balanceBefore, balanceAfter, walletVersion }`)
- [ ] T017 [US2] Create unit tests `tests/unit/domain/*.spec.ts` (bun:test)
  - `money.spec.ts`: scale-2 canonicalization, all rejected input classes, currency
    mismatch throws, immutability of ops
  - `wallet.spec.ts`: OPENING balance, debit insufficient throws, version bump only
    on balance change, rehydrate does not revalidate
  - `wager-transaction.spec.ts`: terminal-state transitions throw, LOSS
    `affectsBalance=false`, REFUND/ROLLBACK require reference, `matchesPayload`
  - `ledger-entry.spec.ts`: unbalanced entry rejected by factory
  - `outbox-message.spec.ts`: backoff schedule, `isDue` logic
  - `events.spec.ts`: `toJSON()` stable shape, key set exact, `MoneyProps` strings

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:unit` green.
3. Update this plan — mark Phase 2 `✅ Completed`.

---

### Phase 3: Persistence & Schema

**Status**: ⬜ Pending
**Objective**: Database schema with DB-enforced invariants (spec §5.9) and
repository/mapper layer connecting domain to MikroORM.
**Dependencies**: Phase 2

**Tasks**:

- [ ] T018 [US3] Create MikroORM entities in `src/database/entities/`
  - `wallet.entity.ts`: `id` uuid PK, `player_id`, `currency char(3)`,
    `balance_amount numeric(20,2)`, `version int`, `created_at`, `updated_at`;
    `@Unique({ name: 'uq_wallet_player_currency', properties: ['playerId','currency'] })`;
    `@Check({ name: 'ck_wallet_balance_non_negative', expression: 'balance_amount >= 0' })`
  - `wager-transaction.entity.ts`: all spec §6.3 fields + `status`, `kind`,
    `failure_code` nullable, `reference_transaction_id` nullable, `processed_at`,
    `result_balance_amount numeric(20,2)` nullable, `result_balance_currency
    char(3)` nullable (replay snapshot, §7.7),     `reference_attempts int DEFAULT 0`,
    `reference_next_attempt_at timestamptz` nullable (used by Phase 7 worker —
    columns created in 001 since it is not yet generated); `@Unique` on
    `idempotency_key` and on (`provider_id`,`external_transaction_id`);
    partial unique index `uq_wager_tx_reference_kind` on
    (`reference_transaction_id`,`kind`) WHERE `status = 'PROCESSED'` (per-type
    reversal backstop, §7.4 — raw SQL in migration 001 if decorator unsupported)
  - `wallet-ledger-entry.entity.ts`: `id`, `wallet_id` (FK, indexed),
    `transaction_id` (FK, indexed), `direction`, money cols, `balance_before_amount`,
    `balance_after_amount`, `created_at`; `@Index(['walletId','id'])` for keyset paging
  - `inbox-message.entity.ts`: `@Unique` (`consumer_name`,`message_id`);
    `outbox-message.entity.ts`: `aggregate_id`, `event_type`, `payload jsonb`,
    `occurred_at`, `attempts`, `next_attempt_at`, `published_at`;
    `@Index(['publishedAt','nextAttemptAt'])`
- [ ] T019 [US3] Create `src/database/mikro-orm.config.ts`
  - entities `./entities/*.ts`, migrations `./migrations`, `dbName` from
    `DATABASE_URL`, `driver: 'postgresql'`, `forceUtcTimezone: true`, no schema push
    (migrations only)
- [ ] T020 [US3] **Generate migration 001 → drift-check → run locally IMMEDIATELY (atomic chain — ORM migration discipline)**
  - `bun run mikro-orm migration:create` from entity diff; review generated SQL in
    `src/database/migrations/`
  - add to the migration: ledger immutability trigger
    `CREATE TRIGGER trg_wallet_ledger_entry_immutable BEFORE UPDATE OR DELETE ON
    wallet_ledger_entry FOR EACH ROW EXECUTE FUNCTION raise_immutable()`
    (function raises exception); verify the `uq_wager_tx_reference_kind` partial
    index from T018 is present in the generated SQL (raw SQL per T018 if not);
    `down()` must drop trigger + index + tables + enums
  - **run immediately**: `bun run mikro-orm migration:up` against local compose PG;
    then `bun run mikro-orm migration:check` (drift) must pass
- [ ] T021 [US3] Create `src/database/mappers.ts`
  - `WalletMapper`, `WagerTransactionMapper` (incl. `result_balance_*` → `Money`),
    `LedgerEntryMapper`, `InboxMapper`, `OutboxMapper` — domain ⇄ entity both
    directions
- [ ] T022 [US3] Create repositories in `src/database/repositories/`
  - `wallet.repository.ts`: `findById(em, id)`,
    `findByIdForUpdate(em, id)` (caller must already be inside `em.transactional`;
    `lockMode: LockMode.PESSIMISTIC_WRITE`)
  - `wager-transaction.repository.ts`: `findByIdempotencyKey`, `findByProviderExternal`,
    `findPendingReferenceDue(at, limit)`
  - `ledger.repository.ts`: `pageByCursor(walletId, cursor?, limit)` — keyset on
    `(created_at, id)` descending, parameterized; `sumByWallet(walletId)` for
    reconciliation
  - `inbox.repository.ts`: insert with unique-violation detection helper
  - `outbox.repository.ts`: `insert`, `claimDueBatch(em, limit)` (raw `em.execute`
    with `FOR UPDATE SKIP LOCKED` — used in Phase 7), `markPublished`, `scheduleRetry`
- [ ] T023 [US3] Create integration tests `tests/integration/schema.spec.ts`
  - against real compose PostgreSQL: unique constraints reject duplicates (wallet
    player+currency, idempotency key, provider+external, inbox pair), partial unique
    index `uq_wager_tx_reference_kind` rejects a second `PROCESSED` same-kind
    reversal and accepts mixed kinds, CHECK rejects
    negative balance, ledger trigger blocks UPDATE and DELETE, migration `up`/`down`
    round-trip on a scratch schema

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:integration` green (compose stack up).
3. Update this plan — mark Phase 3 `✅ Completed`.

---

### Phase 4: Use Case & HTTP API

**Status**: ⬜ Pending
**Objective**: The single atomic submit path plus all spec §9 endpoints with the
decided status mapping.
**Dependencies**: Phase 3

**Tasks**:

- [ ] T024 [US4] Create `src/common/dto/money.dto.ts` and shared validation
  - `MoneyDto { @Matches(/^\d{1,15}\.\d{2}$/) amount: string; @Matches(/^[A-Z]{3}$/) currency: string }`
  - `src/common/idempotency/payload-hash.ts`: `canonicalJson(value)` (recursive
    ASCII key sort, no whitespace) + `payloadHash(businessFields): string` (sha256 hex)
- [ ] T025 [US4] Create wallets module `src/modules/wallets/`
  - `dto/create-wallet.dto.ts` (`playerId` IsUUID, `initialBalance: MoneyDto`),
    `dto/ledger-query.dto.ts` (`cursor` optional string, `limit` default 50 max 100)
  - `wallets.service.ts`: `create(dto)` — inside `em.transactional`: insert wallet;
    if `initialBalance > 0` create `OPENING` `WagerTransaction` (source internal) +
    `CREDIT` ledger entry + `CREDIT` opening outbox event; map unique violation →
    `WalletExistsError` (409)
  - `wallets.controller.ts`: `POST /wallets` → 201 `WalletResponseDto { id, playerId,
    balance, version }`, `GET /wallets/:walletId`,
    `GET /wallets/:walletId/ledger` (keyset cursor, opaque base64 of
    `{createdAt,id}`, default `limit=50`), `POST /wallets/:walletId/reconciliation`
  - `reconciliation.service.ts`: compare `wallet.balance` vs `sumByWallet` ledger →
    `ReconciliationResponseDto { walletId, storedBalance, calculatedBalance,
    difference, consistent, checkedEntries }`; divergence → `logger.warn` +
    `metrics.reconciliationDivergence.inc()` (stub until Phase 8 metrics task) +
    `consistent:false`
- [ ] T026 [US4] Create `src/modules/wagering/submit-transaction.use-case.ts` (core)
  - `execute(cmd: SubmitTransactionCommand): Promise<SubmitTransactionResult>`
    where cmd carries business fields + `idempotencyKey` +
    `ingress: { kind: 'http' } | { kind: 'sqs', messageId, consumerName }`
  - inside `em.transactional`:
    1. inbox dedup when ingress is SQS — insert `inbox_message`; on unique violation
       return stored outcome (no effects) → ack later
    2. idempotency lookup by key → compare `payloadHash` → `IdempotencyConflictError`
       (409) or return stored original outcome — **including the balance observed at
       original processing** (`result_balance_*`) — with `idempotentReplay: true`
       (§7.7); applies to successes *and* stored rejections
    3. `walletRepo.findByIdForUpdate(em, walletId)` — **inside** the transaction
       (missing → `WALLET_NOT_FOUND`)
    4. currency equality check (`CURRENCY_MISMATCH`)
     5. reference resolution for `REFUND`/`ROLLBACK`:
        `findByProviderExternal(providerId, referenceExternalTransactionId)` →
        validate same provider/player/wallet/currency/round (`REFERENCE_MISMATCH`),
        kind rules (`REFERENCE_INVALID_KIND`: REFUND→BET only; ROLLBACK→BET|WIN|REFUND),
        **per-type** single reversal (§7.4, clarified 2026-10-06): existing applied
        same-`kind` reversal → `REFERENCE_ALREADY_REVERSED`; mixed-type reversal on
        one reference (e.g. REFUND then ROLLBACK) is **allowed**; a unique violation
        on the partial index at apply time maps to `REFERENCE_ALREADY_REVERSED`;
        if the referenced transaction is absent → `markPendingReference()` + snapshot
        `result_balance` + `WagerTransactionPendingReference` event, **no balance
        change**, commit
    6. apply `wallet.debit/credit` when `affectsBalance()` (LOSS: skip) →
       ledger entry; insufficient → `REJECTED INSUFFICIENT_FUNDS`; reversal making
       balance negative → `REJECTED REVERSAL_EXCEEDS_BALANCE`
    7. `markProcessed` (or `reject(failureCode)`); set `result_balance` snapshot to
       the wallet balance observed in this transaction; enqueue outbox events
       (`OutboxMessage.enqueue`): `WagerTransactionProcessed` |
       `WagerTransactionRejected` + `WalletBalanceChanged` only when balance moved
  - returns `{ transactionId, status, balance?, idempotentReplay, failureCode? }`
- [ ] T027 [US4] Create `src/modules/wagering/wagering.controller.ts` + DTOs
  - `POST /wagering/transactions` with required `@Headers('idempotency-key')`
    (missing → 400 `VALIDATION_ERROR`); `dto/submit-transaction.dto.ts` rejects
    `kind: "OPENING"` (AC-18 HTTP side) via custom validator
  - response codes: 200 `PROCESSED`, 202 `PENDING_REFERENCE`, 422
    `TRANSACTION_REJECTED` (body carries `status: REJECTED`, `transactionId` +
    `failureCode`), per mapping
    (`PENDING` never returned; 401 `UNAUTHORIZED` / 403 `ROLE_FORBIDDEN` surface
    from the Phase 8 guards)
  - `GET /wagering/transactions/:transactionId` (404 `NOT_FOUND` when unknown)
  - `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- [ ] T028 [US4] Create `src/common/http/exception.filter.ts`
  - global filter maps: `ValidationError`→400 `VALIDATION_ERROR`;
    `IdempotencyConflictError`→409 `IDEMPOTENCY_CONFLICT`;
    `WalletExistsError`→409 `WALLET_EXISTS`;
    authenticated without required role → 403 `ROLE_FORBIDDEN`;
    `ReferenceResolutionError`/business reject→422 `TRANSACTION_REJECTED` +
    `failureCode`; read-path not-found→404 `NOT_FOUND` (a wallet miss during
    submit is a business reject → 422 + `failureCode: WALLET_NOT_FOUND`); transient
    infra (`ECONNREFUSED`, SQS/PG
    down)→503 `SERVICE_UNAVAILABLE` with `Retry-After: 5`;
    missing/invalid token or JWKS fail-closed→401 `UNAUTHORIZED`
  - body shape `{ statusCode, code, message, failureCode?, transactionId?,
    idempotentReplay?, correlationId? }` — replays of stored rejections repeat the
    original 422 with `idempotentReplay: true`
- [ ] T029 [US4] Create integration tests `tests/integration/http-api.spec.ts`
  - AC-1..AC-8, AC-17, AC-18(HTTP) end-to-end against real PG: wallet create/dupe,
    BET success, insufficient funds, replay (original balance) + conflict, WIN/LOSS,
    refund once/twice, reconciliation consistent, OPENING rejected, ledger
    pagination cursor stability
  - cross-currency submit (currency ≠ wallet currency) → 422
    `TRANSACTION_REJECTED` + `failureCode: CURRENCY_MISMATCH`,
    balance unchanged, no ledger entry
  - mixed-type reversal allowed (REFUND then ROLLBACK on one BET both apply) while
    a second same-type reversal is `REJECTED REFERENCE_ALREADY_REVERSED`

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:unit && bun run test:integration` green.
3. Update this plan — mark Phase 4 `✅ Completed`.

---

### Phase 5: Concurrency Hardening

**Status**: ⬜ Pending
**Objective**: Prove §8 correctness with real parallelism (no sequential mocks).
**Dependencies**: Phase 4

**Tasks**:

- [ ] T030 [US5] Create `tests/concurrency/hot-wallet.spec.ts` (AC-11)
  - seed wallet `100.00`; `Promise.all` two `POST /wagering/transactions` bets of
    `80.00` (distinct idempotency keys); assert one `PROCESSED`, one `REJECTED`
    `INSUFFICIENT_FUNDS`, balance `20.00`, exactly one `DEBIT` row in ledger
- [ ] T031 [US5] Create `tests/concurrency/duplicate-flood.spec.ts` (AC-12)
  - same key + payload fired 50× in parallel → exactly one stored transaction, one
    debit, all responses consistent (`idempotentReplay` on ≥49)
- [ ] T032 [US5] Create `tests/concurrency/multi-instance.spec.ts`
  - boot 3 app instances (`bun src/main.ts` on ports 3001-3003, same DB/queues,
    spawned via test helper); mixed workload across shared + distinct wallets;
    final invariant check: for every wallet `balance == Σledger` and no duplicate
    debit per transaction
- [ ] T033 [US5] Add lock-conflict instrumentation in `src/observability/metrics.service.ts`
  - counters `wagering_lock_conflicts_total`, `wagering_tx_total{status}`; increment
    in the use case around lock acquisition (count `findByIdForUpdate` waits >
    50ms); file created here as a minimal stub if Phase 8 not yet reached

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:concurrency` green (3 real instances).
3. Update this plan — mark Phase 5 `✅ Completed`.

---

### Phase 6: SQS Ingestion

**Status**: ⬜ Pending
**Objective**: Spec §10 consumer: same use case, inbox dedup, ack after commit,
error classification, DLQ, graceful shutdown.
**Dependencies**: Phase 4

**Tasks**:

- [ ] T034 [US6] Create `scripts/create-queues.ts` + `src/messaging/sqs.client.ts`
  - queues `wager-transactions.fifo` (FIFO,
    `ContentBasedDeduplication=false`) and `wager-transactions-dlq.fifo`; main queue
    `RedrivePolicy` with `maxReceiveCount: 5` → DLQ; idempotent script
    (create-if-missing); add package.json script `"queue:setup": "bun scripts/create-queues.ts"`
  - client factory: `SQSClient` with `endpoint: SQS_ENDPOINT`, dummy local creds,
    region `us-east-1`
- [ ] T035 [US6] Create `src/messaging/wager-transaction.consumer.ts`
  - long-poll loop (`setInterval` + `receiveMessage` `MaxMessages: 10`,
    `WaitTimeSeconds: 20`, `VisibilityTimeout: 30`): parse envelope
    (`messageId`, `type === "WagerTransactionRequested"`, `occurredAt`, `data`);
    permanent failures — missing/invalid fields **or `data.kind === "OPENING"`
    (AC-18 queue side)** — are classified permanent (log + delete → redrive path or
    explicit DLQ send); otherwise run `SubmitTransactionUseCase` with
    `ingress: { kind: 'sqs', messageId, consumerName: 'wager-transaction-consumer' }`
  - **deleteMessage only after the use case commits**; business `REJECTED` outcomes
    commit → ack; thrown transient errors → do NOT delete (visibility redelivery);
    structured logs with `messageId`/`correlationId`
- [ ] T036 [US6] Wire consumer lifecycle in `src/messaging/messaging.module.ts`
  - start polling `onApplicationBootstrap` when `WORKERS_ENABLED=true`; graceful
    `onApplicationShutdown`: stop receiving, await in-flight handler (bounded 25s),
    then close client (SIGTERM contract §10)
- [ ] T037 [US6] Create integration tests `tests/integration/sqs-ingress.spec.ts`
  - AC-13: send identical `messageId` twice → single effect, both deleted
  - redelivery before ack (simulate visibility expiry) → no duplicate effect
  - `REFUND` enqueued before its `BET` → `PENDING_REFERENCE` row exists (resolution
    asserted in Phase 7)
  - poison message (missing required `data` fields, and `kind: "OPENING"`) 6× →
    arrives in DLQ, service still healthy (AC-14, AC-18)

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:integration` (sqs suite) green (LocalStack up).
3. Update this plan — mark Phase 6 `✅ Completed`.

---

### Phase 7: Outbox & Reference Workers

**Status**: ⬜ Pending
**Objective**: Post-commit publishing safe with concurrent publishers, and
out-of-order references resolved with bounded retries.
**Dependencies**: Phase 6

**Tasks**:

- [ ] T038 [US7] Create `src/workers/outbox-publisher.worker.ts`
  - interval loop (500ms, jitter): inside `em.transactional` claim batch via
    `em.execute('SELECT id FROM outbox_message WHERE published_at IS NULL AND
    (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY id LIMIT 50
    FOR UPDATE SKIP LOCKED')`
  - publish each to `wager-transactions.fifo` (`sendMessageBatch`), then in the same
    tx `markPublished`; on publish failure `scheduleRetry(attempts++,
    nextAttemptAt = now + min(2^attempts * 1s, 5min))`
  - crash-window semantics: publish-then-mark means crash → re-publish → consumers
    tolerate duplicates (at-least-once, §11)
- [ ] T039 [US7] **Generate migration 002 → drift-check → run locally IMMEDIATELY (atomic chain — ORM migration discipline)**
  - NOTE: `reference_attempts` / `reference_next_attempt_at` are already created in
    migration 001 (T020); migration 002 exists only if the reprocessor needs any
    further schema delta discovered while implementing T040 — if none is needed,
    record "no schema delta" here and skip creating an empty migration
  - if created: reversible `down()`, run via `bun run mikro-orm migration:up`
    immediately, then `migration:check` passes
- [ ] T040 [US7] Create `src/workers/pending-reference.worker.ts`
  - query `PENDING_REFERENCE` due rows (`reference_next_attempt_at <= now()`); per
    row in a transaction re-run reference resolution: resolvable → apply
    balance/ledger, `markProcessed`, set `result_balance` snapshot, enqueue
    `WagerTransactionProcessed` + `WalletBalanceChanged`; not resolvable → if
    `reference_attempts >= 10` or age > 24h → `REJECTED` `REFERENCE_NOT_FOUND` +
    `WagerTransactionRejected`; else `reference_attempts++` with backoff
    `min(2^attempts * 30s, 30min)`
- [ ] T041 [US7] Register workers in `src/workers/workers.module.ts`
  - both workers as `@Injectable` services started from `onApplicationBootstrap`
    when `WORKERS_ENABLED=true`; single shared scheduler guard so tests can disable
- [ ] T042 [US7] Create integration tests `tests/integration/workers.spec.ts` (AC-9, AC-10, AC-15)
  - out-of-order ROLLBACK → BET → reprocessor resolves to `PROCESSED` with inverted
    ledger entry
  - never-arriving reference → 10 attempts → `REJECTED REFERENCE_NOT_FOUND` +
    `WagerTransactionRejected` row in outbox
  - crash-after-commit: insert pending outbox row with app stopped → start two
    instances → row published, `published_at` set
  - two publisher instances against 200 pending rows → all published, no row lost

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:integration` (workers suite) green.
3. Update this plan — mark Phase 7 `✅ Completed`.

---

### Phase 8: Auth & Observability

**Status**: ⬜ Pending
**Objective**: Keycloak OIDC on the API (health open), structured
redacted logs, prometheus metrics, full readiness.
**Dependencies**: Phase 4

**Tasks**:

- [ ] T043 [US8] Create `keycloak/realm-export.json`
  - realm `wagering`; client `wagering-api` (bearer-only, issuer
    `http://localhost:8080/realms/wagering`); roles `transact:write`,
    `transact:read`; test users `provider-client` (both roles), `operator`
    (`transact:read` + `transact:write` — needed for POST reconciliation, AC-17),
    `read-only-client` (`transact:read` only) and `write-only-client`
    (`transact:write` only) — the two single-role users exist so T048 can prove
    both 403 directions;
    direct-grant enabled for local testing
- [ ] T044 [US8] Create `src/auth/jwt.guard.ts` + `src/auth/public.decorator.ts` + `src/auth/roles.guard.ts`
  - global `APP_GUARD`: `@Public()` skips; otherwise require `Authorization: Bearer`
    validated against `KEYCLOAK_ISSUER` JWKS (`iss` + `aud` + `exp`), fail-closed on
    JWKS errors → 401 `UNAUTHORIZED` (never 500 → business path)
  - `@Roles('transact:write')` on all POSTs, `@Roles('transact:read')` on GETs;
    missing required role → **403 `ROLE_FORBIDDEN`**; health controllers and
    `GET /metrics` stay `@Public()` (AC-16, T046)
- [ ] T045 [US8] Create `src/observability/logger.ts` (pino) and wire in `src/main.ts`
  - base bindings `service: 'wagering-processor'`; middleware assigns/propagates
    `correlationId` (honors inbound `x-correlation-id`, else uuid) into
    AsyncLocalStorage and the response header; child loggers in use
    case/consumer/workers bind `transactionId`, `walletId`, `providerId`, `messageId`
  - `redact` paths: `req.headers.authorization`, `*.data`, `*.payload`, `*.body` — no
    full financial payloads (§12)
- [ ] T046 [US8] Complete `src/observability/metrics.service.ts` (prom-client; extends
  the Phase 5 stub)
  - `GET /metrics` (`@Public`): counters `wagering_tx_total{status}`,
    `wagering_duplicates_total`, `wagering_sqs_retries_total`,
    `wagering_dlq_received_total`, `wagering_reconciliation_divergences_total`,
    `wagering_lock_conflicts_total`; gauge `wagering_outbox_lag` (oldest unpublished
    age seconds); histogram `wagering_processing_seconds`
  - instrument: use case (status/duration/duplicates), consumer (retries/DLQ),
    outbox worker (lag), reconciliation
- [ ] T047 [US8] Extend readiness in `src/health/health.service.ts`
  - add `getQueueAttributes` on main + DLQ; response `{ postgres, sqs }`; any
    failure → 503 (completes T007). Keycloak is deliberately **not** probed —
    spec §9 defines ready = "PostgreSQL and SQS reachable" (clarified 2026-10-06)
- [ ] T048 [US8] Create integration tests `tests/integration/auth-observability.spec.ts` (AC-16)
  - health endpoints and `GET /metrics` 200 without token; `POST /wallets` without
    token or with wrong-audience token → 401 `UNAUTHORIZED`; with valid token → 201;
    `read-only-client` on POST → 403 `ROLE_FORBIDDEN`; `write-only-client` on GET →
    403 `ROLE_FORBIDDEN`; `/metrics` exposes a counter after a submit; log fixture
    asserts `authorization` header absent from output

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Tests — `bun run test:integration` (auth suite) green.
3. Update this plan — mark Phase 8 `✅ Completed`.

---

### Phase 9: Resilience Suite & Graded Docs

**Status**: ⬜ Pending
**Objective**: Full §13 failure-mode coverage + the graded documentation deliverables
(README setup/commands, root `ARCHITECTURE.md`, foundation sync).
**Dependencies**: Phases 5–8

**Tasks**:

- [ ] T049 [US9] Create `tests/integration/crash-recovery.spec.ts`
  - kill consumer mid-message after commit before ack → restart → no duplicate
    effect (inbox); PG stopped → readiness 503 + submit 503
    `SERVICE_UNAVAILABLE`; PG back → recovery; final invariant
    `wallet.balance == Σledger` for all touched wallets
- [ ] T050 [US9] Create `tests/concurrency/spec-section13.spec.ts`
  - remaining §13 cases: distinct wallets processed in parallel (assert no
    global serialization), `ROLLBACK`/`REFUND` delivered before reference via queue,
    restart-consistency sweep re-checking all wallets against ledger sums
  - (§13 items 1,2,4,5,6 covered by T030/T031/T032/T042 — reference them in the
    suite header comment)
- [ ] T051 [US9] Create `tests/unit/idempotency-edges.spec.ts`
  - canonical JSON stability (key-order permutations → same hash), `Idempotency-Key`
    header excluded from hash, non-business fields excluded, AC-6 hash divergence
- [ ] T052 [US9] Update `README.md` — **append** `## Setup` and `## Commands`
  sections (never remove spec content)
  - Setup: prerequisites (Bun 1.x, Docker), `cp .env.example .env`,
    `docker compose up -d`, `bun run queue:setup`, `bun run mikro-orm migration:up`,
    `bun run dev`; auth: obtain token via direct grant against local Keycloak
  - Commands table: `dev`, `validate`, `test`, `test:unit`, `test:integration`,
    `test:concurrency`, `queue:setup`, `mikro-orm migration:create|up|check`;
    document `Idempotency-Key` default `{providerId}:{externalTransactionId}` and
    the `payloadHash` canonical-JSON algorithm (§9 requirement)
- [ ] T053 [US9] Create root `ARCHITECTURE.md` (graded artifact §14)
  - decisions with rationale + trade-offs + limitations: MikroORM (vs TypeORM),
    pessimistic lock (vs optimistic/conditional), single-service + in-process
    workers, outbox/inbox, Keycloak, LocalStack, status mapping, failureCode
    taxonomy, retry limits; links to `docs/architecture.md` (full source of truth)
    and `docs/decisions/` — sync relationship stated explicitly
- [ ] T054 [US9] Sync foundation docs with reality (one pass per file)
  - `docs/architecture.md`: verify decisions table matches implementation; flip its
    decision-state annotations (intro Status and ✅ Legend) from
    decided/pending to implemented
  - `docs/integrations.md`: flip its header Status sentence and catalog row 4 from
    decided/spec-only to implemented; confirm the status-code contract matches
    shipped behavior
  - `docs/infrastructure.md`: flip its header Status sentence; mark
    compose/queues/Keycloak created with file references
  - `docs/environments.md`: update the local Runtime/Status cells to reflect the
    implemented stack
  - root `ARCHITECTURE.md`: verify its decisions summary still matches
    `docs/architecture.md` (owns T053 output)
- [ ] T055 [US9] (Optional) Load-test scaffold `tests/load/` + script `test:load`
  - `bun run test:load` drives parallel submits against local stack; report
    p50/p95/p99, error rate, lock conflicts, outbox lag — methodology documented
    next to results (§14 differential)

**After completing this phase**:
1. TypeScript Validation — `bun run validate`.
2. Full verification — `bun test` (all suites) with compose stack running; capture
   command, exit code, key output as evidence.
3. Update this plan — mark Phase 9 `✅ Completed`.

---

## ✅ Master Checklist

### Phase 1: Foundation & Local Stack
- [x] T001 [US1] Scaffold Bun+NestJS project (`package.json` + scripts)
- [x] T002 [US1] Strict `tsconfig.json`
- [x] T003 [US1] `docker-compose.yml` (PostgreSQL, LocalStack, Keycloak)
- [x] T004 [US1] `src/main.ts` bootstrap + pipes/filters + shutdown hooks
- [x] T005 [US1] `src/app.module.ts` root wiring
- [x] T006 [US1] `src/config/env.validation.ts` + `.env.example` + `.gitignore`
- [x] T007 [US1] Health endpoints `src/health/*` (`@Public`)
- [x] TypeScript validation passes (build only when explicit)

### Phase 2: Domain Core & Events
- [ ] T008 [US2] `src/domain/money/money.ts`
- [ ] T009 [US2] `src/domain/enums.ts`
- [ ] T010 [US2] `src/domain/failure-codes.ts`
- [ ] T011 [US2] `src/domain/errors.ts`
- [ ] T012 [US2] `src/domain/wallet/wallet.ts`
- [ ] T013 [US2] `src/domain/ledger/wallet-ledger-entry.ts`
- [ ] T014 [US2] `src/domain/wager-transaction/wager-transaction.ts`
- [ ] T015 [US2] Inbox + Outbox domain `src/domain/{inbox,outbox}/*.ts`
- [ ] T016 [US2] Event envelope `src/events/*` (§11)
- [ ] T017 [US2] Unit tests `tests/unit/domain/*.spec.ts`
- [ ] TypeScript validation passes (build only when explicit)

### Phase 3: Persistence & Schema
- [ ] T018 [US3] MikroORM entities `src/database/entities/*` (uniques + CHECK + snapshots + reversal partial index)
- [ ] T019 [US3] `src/database/mikro-orm.config.ts`
- [ ] T020 [US3] Migration 001 + ledger trigger — **generate → drift-check → run locally IMMEDIATELY (atomic chain)**
- [ ] T021 [US3] `src/database/mappers.ts`
- [ ] T022 [US3] Repositories `src/database/repositories/*` (incl. `FOR UPDATE`)
- [ ] T023 [US3] Schema integration tests `tests/integration/schema.spec.ts`
- [ ] TypeScript validation passes (build only when explicit)

### Phase 4: Use Case & HTTP API
- [ ] T024 [US4] Money DTO + `payload-hash.ts` canonical JSON
- [ ] T025 [US4] Wallets module + reconciliation `src/modules/wallets/*`
- [ ] T026 [US4] `submit-transaction.use-case.ts` atomic core (replay snapshots)
- [ ] T027 [US4] Wagering controller + DTOs (OPENING blocked, §4 status mapping)
- [ ] T028 [US4] Exception filter + status mapping `src/common/http/*`
- [ ] T029 [US4] HTTP integration tests (AC-1..8, 17, 18 + cross-currency + mixed-type reversal)
- [ ] TypeScript validation passes (build only when explicit)

### Phase 5: Concurrency Hardening
- [ ] T030 [US5] Hot-wallet 100/80/80 test (AC-11)
- [ ] T031 [US5] 50× duplicate flood test (AC-12)
- [ ] T032 [US5] 3-instance multi-process test
- [ ] T033 [US5] Lock-conflict metrics instrumentation
- [ ] TypeScript validation passes (build only when explicit)

### Phase 6: SQS Ingestion
- [ ] T034 [US6] Queue setup script (`queue:setup`) + SQS client
- [ ] T035 [US6] Consumer (ack-after-commit, OPENING permanent-fail, error classes)
- [ ] T036 [US6] Consumer lifecycle + SIGTERM drain
- [ ] T037 [US6] SQS integration tests (AC-13, 14, 18)
- [ ] TypeScript validation passes (build only when explicit)

### Phase 7: Outbox & Reference Workers
- [ ] T038 [US7] Outbox publisher (`SKIP LOCKED`, backoff)
- [ ] T039 [US7] Migration 002 delta if needed — **generate → drift-check → run locally IMMEDIATELY (atomic chain)**
- [ ] T040 [US7] `PENDING_REFERENCE` reprocessor (10 attempts / backoff / 24h TTL)
- [ ] T041 [US7] Workers module registration (`WORKERS_ENABLED`)
- [ ] T042 [US7] Worker integration tests (AC-9, 10, 15)
- [ ] TypeScript validation passes (build only when explicit)

### Phase 8: Auth & Observability
- [ ] T043 [US8] Keycloak realm export `keycloak/realm-export.json`
- [ ] T044 [US8] JWT + roles guards (`@Public`, fail-closed)
- [ ] T045 [US8] Pino logger + correlationId + redaction
- [ ] T046 [US8] Prometheus metrics + instrumentation (extends T033 stub)
- [ ] T047 [US8] Readiness incl. SQS (completes T007)
- [ ] T048 [US8] Auth/observability integration tests (AC-16)
- [ ] TypeScript validation passes (build only when explicit)

### Phase 9: Resilience Suite & Graded Docs
- [ ] T049 [US9] Crash-recovery integration tests
- [ ] T050 [US9] §13 remaining concurrency cases
- [ ] T051 [US9] Idempotency/canonical-hash edge unit tests
- [ ] T052 [US9] README.md `## Setup` + `## Commands` append (spec §14 deliverable)
- [ ] T053 [US9] Root `ARCHITECTURE.md` (spec §14 deliverable)
- [ ] T054 [US9] Foundation docs sync (`docs/architecture.md` etc.)
- [ ] T055 [US9] (Optional) Load-test scaffold `bun run test:load`
- [ ] TypeScript validation passes; full `bun test` evidence captured

## Clarifications

Clarifications artifact:
[`docs/plans/20261006111327-full-wagering-processor-plan.clarifications.md`](./20261006111327-full-wagering-processor-plan.clarifications.md)
(session 2026-10-06; brainstorm ⚠️ items were resolved during planning under
**Proposed Solution → Decided now**).

Key resolved decisions (applied to this plan):

- **Reversal uniqueness = per-type + DB partial unique index** on
  `(reference_transaction_id, kind) WHERE status = 'PROCESSED'`; mixed-type
  reversals allowed (spec §7.4 literal reading) → T018/T020/T026/T029.
- **`PENDING` dropped from HTTP mapping** — 202 returns only
  `status: PENDING_REFERENCE`; `PENDING` remains internal in-flight enum only →
  Proposed Solution §4, T027.
- **403 `ROLE_FORBIDDEN`** for authenticated-but-unauthorized; 401 `UNAUTHORIZED`
  strictly authentication failure → §4, T028, T044.
- **`/health/ready` = PostgreSQL + SQS only**; Keycloak explicitly excluded →
  T047.
- **Cross-currency e2e added**: 422 `TRANSACTION_REJECTED` +
  `failureCode: CURRENCY_MISMATCH` integration case → T029.

Deferred open points: none — no `[NEEDS CLARIFICATION]` markers remain.

---

## Execution Log

### 2026-10-06 — Phase 1 (Foundation & Local Stack) executed via TDD

**Tasks completed (fully):** T001, T002, T003, T004, T005, T006, T007
**Tasks completed (partially):** none
**Tasks not executed in this run:** none (all Phase 1 tasks)

**TDD slices:** T006 RED→GREEN (`tests/unit/config/env.validation.spec.ts`,
5 pass); T007 RED→GREEN (`tests/unit/health/health.service.spec.ts`); T004/T005
integration RED→GREEN (`tests/integration/bootstrap.spec.ts`, 2 pass:
`GET /health/live` 200 `{"status":"ok"}`, `GET /health/ready` 200
`{"postgres":"ok"}` against the running docker stack).

**Unplanned changes:**
- `src/common/http/exception.filter.ts` — created in Phase 1 (T004 requires a
  global `HttpExceptionFilter` in `main.ts`); the plan schedules its full
  status-mapping body under T028 (Phase 4).
- `src/auth/public.decorator.ts` — created in Phase 1 (T007 requires `@Public()`
  markers); the plan schedules it under T044 (Phase 8).
- `devDependency @types/express` — added; `exception.filter.ts` imports express types.
- `keycloak/realm-export.json` — placeholder realm `wagering` created now because
  T003 mounts it as a volume; full realm (client/roles/users) is T043 (Phase 8).

**Implementation deviations:**
- T001 — `@nestjs/config` added to deps: the T001 dep list omitted it, but T005
  mandates `ConfigModule.forRoot`.
- T002 — final `tsconfig.json` uses `"module": "esnext"`,
  `"moduleResolution": "bundler"`, `"types": ["bun"]` instead of the plan's
  `"module": "commonjs"` / `"moduleResolution": "node"`: a node16 attempt caused
  TS1479 CJS/ESM errors and bun:test resolution failure.
  `experimentalDecorators` + `emitDecoratorMetadata` kept (required by Bun for
  NestJS constructor DI).
- T003 — image pins: `localstack/localstack:4.13.1` (plan said `latest`;
  2026.9.0+ refuses to start without `LOCALSTACK_AUTH_TOKEN`) and
  `quay.io/keycloak/keycloak:26.8` (plan's tag `26` does not exist).
  `docker compose config -q` and `docker compose up -d --wait` both exit 0;
  all 3 containers healthy.

**Environment decisions:**
- Native PostgreSQL 18 Windows service (`D:\PostgreSQL`, port 5432) conflicted
  with Docker postgres on host 5432; user approved stopping service
  `postgresql-x64-18` during development — Docker keeps 5432, `DATABASE_URL`
  stays `localhost:5432`.
- Bun upgraded 1.3.14 → 1.4.2 (1.3.14 did not apply tsconfig
  `experimentalDecorators`/`emitDecoratorMetadata` on `bun run`, breaking NestJS
  constructor DI with `paramtypes=[null]`).
- MikroORM v7 + `@mikro-orm/nestjs` 7.1.0: default (unnamed) EntityManager
  provider is registered under the `EntityManager` class token;
  `@InjectEntityManager()` without args yields token `"undefined_EntityManager"`
  and fails DI — must use `@Inject(EntityManager)` with a value (non-type-only)
  import.
- MikroORM v7: `discovery.warnWhenNoEntities: false` needed (v7 throws when
  zero entities); `driver: PostgreSqlDriver` set at the `forRootAsync` options
  level; `autoLoadEntities: true`.

**Verification evidence (2026-10-06, all fresh):**
- `docker compose ps` → postgres / localstack / keycloak all `Up (healthy)`.
- `bun test` → 10 pass / 0 fail across 3 files.
- `bun run validate` (`tsc --noEmit`) → exit 0.
- Dev-server smoke: `bun run dev` + `GET /health/live` 200,
  `GET /health/ready` 200, Keycloak `http://localhost:8080/realms/wagering` 200.
- `.env.example` copied to local `.env` (gitignored).

**Files changed:** `.env.example`, `.gitignore`, `bun.lock`, `docker-compose.yml`,
`keycloak/realm-export.json`, `package.json`, `tsconfig.json`, `src/app.module.ts`,
`src/main.ts`, `src/common/http/exception.filter.ts`,
`src/health/{module,controller,service}.ts`, `src/auth/public.decorator.ts`,
`src/config/env.validation.ts`, `tests/unit/config/env.validation.spec.ts`,
`tests/unit/health/health.service.spec.ts`, `tests/integration/bootstrap.spec.ts`

**Documentation updates:** `docs/architecture.md`, `docs/environments.md`,
`docs/glossary.md`, `docs/infrastructure.md`, `docs/integrations.md`
(status lines moved from spec-only to implemented-vs-planned),
this plan (status + Execution Log), and
`docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md` (new pattern).

### 2026-10-06 — Phase 1 review round (`/pwf-review`, 7 agents)

**Agents:** `nestjs-reviewer`, `security-sentinel`, `kieran-typescript-reviewer`,
`code-simplicity-reviewer`, `architecture-strategist`, `learnings-researcher`,
`workflow/lint`. Verdict: **no Critical findings**; fixes applied before commit:

- Compose host ports bound to `127.0.0.1` only (postgres/localstack/keycloak) —
  closes LAN exposure and makes the `docs/integrations.md` "not internet-exposed"
  claim true.
- `PORT` validation hardened: `@Min(1) @Max(65535)` (empty/`0`/out-of-range now
  fail boot instead of silently binding an ephemeral port); `src/main.ts` reads
  the validated value via `ConfigService.getOrThrow('PORT')` and
  `bootstrap().catch(...)` exits 1 (no lost buffered logs).
- `clientUrl: config.getOrThrow<string>('DATABASE_URL')`; factory-level `driver`
  duplicate removed (options-level `driver: PostgreSqlDriver` is the one
  `createEntityManager` reads).
- `exception.filter.ts` rewritten with a field allowlist
  (`message`/`error`/`errorCode` only — never spread), `statusCode` always from
  `getStatus()`, and `Logger` warn/error per request line; covered by new
  `tests/unit/common/http/exception.filter.spec.ts` (RED→GREEN, incl. leak +
  statusCode-precedence cases).
- `ServiceUnavailableException(..., { cause: error })` preserves the root cause;
  dead `@IsOptional()` removed from the four defaulted env fields; `WORKERS_ENABLED`
  transform collapsed to one ternary.
- `package.json` gains `"engines": { "bun": ">=1.4.2" }` (G1 floor); integration
  `beforeAll` timeout 15s (cold-start protection); `let app: INestApplication | undefined`.
- Pattern doc: required-vs-optional env-var checklist wording corrected, harness
  pointer made line-rot-proof, `main.ts`/factory snippets synced; plan T002/T003
  task text annotated with deviation pointers.

**Gates after fixes:** `bun run validate` exit 0 · `bun test` 16 pass / 0 fail ×2 ·
`docker compose config -q` exit 0 · stack recreated, 3/3 healthy on loopback ·
dev smoke live 200 / ready 200.

### 2026-10-06 — Phase 1 focused re-review round 2 (fix round applied)

**Agents:** `review/security-sentinel` + `review/kieran-typescript-reviewer` re-run on the
fix-round delta. Verdict: **no Critical findings**; Changes Requested on round-1 gaps.
Fixes applied (TDD — RED first, then GREEN):

- **`HOST` env added** (`@IsIn(['127.0.0.1', '0.0.0.0'])`, default `127.0.0.1`) and
  `app.listen(port, host)` — the app itself is now loopback-only (verified live:
  `netstat` → `127.0.0.1:3000 LISTENING`), completing the compose-side loopback
  binding that round 2 flagged as undermined by `0.0.0.0`.
- **`PORT` → `@IsInt()`** (rejects `3000.5`; boundaries 1/65535 tested);
  `DATABASE_URL` must match `postgres(ql)?://` (fails fast with an actionable message
  instead of dying inside `MikroOrmModule.init`); `LOG_LEVEL` typed as its literal union.
- **`exception.filter.ts`**: 5xx responses now log `cause` + stack server-side (a DB
  outage previously logged only `GET /health/ready -> 503`); instance-level `errorCode`
  merged for string-body exceptions (T028 error contract); `headersSent` guard before
  writing; `method`/`url` log-line fallbacks.
- **Wiring moved to DI**: global pipe/filter registered in `AppModule` via `APP_PIPE` +
  `APP_FILTER useExisting` (class kept in `providers`), so the integration harness
  exercises the real registration; new integration test asserts `GET /unknown` → 404
  body has exactly `{statusCode, message, error}` (allowlist contract end-to-end) and
  that `HttpExceptionFilter` resolves via `app.get()`.
- **Test hardening**: `health.service.spec` asserts `getStatus() === 503` and `cause`
  preservation; integration `afterAll` timeout 15s, `baseUrl` initialized, `AddressInfo`
  narrowing guard (no `as` cast); filter spec covers `errorCode` (string + subclass
  options) and the `headersSent` no-write path; env spec covers `WORKERS_ENABLED`
  garbage, `HOST` accept/reject, DB scheme, PORT float/boundaries.
- **Misc**: keycloak realm mount `:ro`; `.env.example` documents `HOST` and the
  accepted `WORKERS_ENABLED` values; bootstrap failure path flushes buffered logs
  before `process.exit(1)`; integration hook timeout 15s (round-1 cold-start flake).

**Gates after round-2 fixes:** `bun run validate` exit 0 · `bun test` **26 pass / 0 fail**
(4 files) · `docker compose config -q` exit 0 · dev smoke live 200 / ready 200 bound to
`127.0.0.1:3000` only.

**Still deferred (recommendations, not applied):** Keycloak admin credential
parameterization (local-only creds, loopback-published), `@nestjs/throttler` + `helmet` +
`X-Powered-By` disable (Phase 4), `IS_PUBLIC_KEY` consumption regression test (lands with
the Phase 8 guard), linter (OxLint) as separate chore, `.gitignore` expansion before
T043, `bun audit` wired into CI (reviewer ran it: 198 packages, 0 vulnerabilities),
readiness probes for SQS/Keycloak (plan T047), HTTPS/`trust proxy` for non-local envs.

### 2026-10-06 — Phase 1 focused re-review round 3 (second fix round applied)

**Agents:** `review/security-sentinel` + `review/kieran-typescript-reviewer` re-run on
the round-2 delta. Verdict: **no Critical findings**; fixes applied (TDD):

- `headersSent` guard moved **after** logging — post-stream failures still emit the 5xx
  log (line + cause + stack); only the response write is skipped. Spec covers
  "logs but does not write".
- 5xx logging now test-covered via `Logger.prototype` spies: `cause=` + stack asserted,
  non-Error string causes logged too, credentials in cause messages redacted
  (`user:pass@` → `//***@`), and log lines use the pathname only (query strings —
  potential tokens/PII — are dropped).
- Integration spec proves global wiring through
  `app.get(ApplicationConfig).getGlobalFilters()` / `.getGlobalPipes()` (filter is an
  `HttpExceptionFilter`, pipe is a `ValidationPipe`). ⚠ institutional finding:
  `app.get(APP_FILTER)` on the enhancer token makes Bun 1.4.2 **exit(1) silently**
  (no error, no output) — recorded as an anti-pattern in the pattern doc; the
  `@nestjs/core/application-config` deep import is allowed by the package `exports`
  map and is the supported assertion path.
- `health.service.spec` uses `instanceof` narrowing instead of unsound `unknown`→T
  casts; integration adds a boot guard, `listen(0, '127.0.0.1')` (loopback even in
  tests), and a comment explaining why `AppModule` imports must stay dynamic
  (ConfigModule validates env at module-evaluation time; static imports hoist above
  the `??=` defaults).
- `DATABASE_URL` regex tightened to `^postgres(ql)?:\/\/\S+$` (case-insensitive;
  scheme-only URLs rejected) with accept/reject spec cases; filter uses an `isRecord`
  type guard instead of a bare cast; `HOST` rejects `''`/`localhost`/`::` (spec).

**Gates after round-3 fixes:** `bun run validate` exit 0 · `bun test` **32 pass / 0 fail**
(4 files) · `docker compose config -q` exit 0.

**Still deferred (round-3 additions):** `test:concurrency` points at `tests/concurrency`,
which the plan creates later (T030–T032) — script intentionally ahead of the suite;
pino/pino-http logger injection into the filter decided at T045 (prototype spies work
until then); `HOST=0.0.0.0` must be set explicitly in any container/K8s task definition
(default is fail-closed loopback by design); log-volume controls arrive with
`@nestjs/throttler` (Phase 4).

### 2026-10-06 — Phase 1 focused re-review round 4 (third fix round applied)

**Agents:** `review/security-sentinel` + `review/kieran-typescript-reviewer` re-run on
the round-3 delta. Verdict: **no Critical findings**; fixes applied (TDD):

- **Absolute-form request targets** (`GET https://user:pass@host/path?x=1 HTTP/1.1`)
  previously bypassed the pathname-only fix and logged credentials verbatim — the
  filter now derives the pathname via origin-form passthrough or
  `new URL(target).pathname` (fallback `/`), and applies `CREDENTIALS_IN_URL`
  redaction to the log line *and* the stack/message argument as defense in depth.
  Two specs pin the behavior (`/path` with creds+token dropped; bare host → `/`).
- Coverage claims made true: string causes logged with redaction
  (`cause=postgres://***@db down`), object causes log no `cause=` suffix, 4xx
  asserts warn-only (`errorCalls` length 0), uppercase `POSTGRES://` accepted.
  Tuple `as [string, string]` casts replaced with `?? []` + `String(...)`.
- **ValidationPipe flags asserted behaviorally** in integration: `transform()`
  coerces `'8080'` → `8080`, and an extraneous property rejects (whitelist +
  forbidNonWhitelisted) — the flags are `protected` in Nest 12, so presence alone
  was no longer the whole contract.
- **Mutation experiments executed** (kieran's open question): removing the
  `APP_FILTER` provider line → integration suite fails (1 fail); removing the
  `APP_PIPE` block → fails (2 fails); restored file re-verified 37 pass.
- `tests/unit/common/http/exception.filter.spec.ts` was **untracked** — now staged
  (`git add`), so the filter ships with its logging/allowlist specs (count now lives
  in this log per round, not in prose).
- Pattern doc checklist updated to `listen(0, '127.0.0.1')` (round-3 change had
  drifted from the checklist line).

**Gates after round-4 fixes:** `bun run validate` exit 0 · `bun test` **37 pass / 0 fail**
(4 files, 81 expects) · `docker compose config -q` exit 0 · mutations verified
red→restored-green.

### 2026-10-06 — Phase 1 focused re-review rounds 5–6 (final hardening + index sync)

**Agents:** `review/security-sentinel` + `review/kieran-typescript-reviewer` (round 5),
both re-run as the final gate (round 6 — **kieran: Approved**, security's remaining
findings were doc-sync, closed below). Fixes applied:

- **Git index resynced** (round-5 Critical: staged snapshot was the baseline while the
  worktree carried rounds 2–4): `git add -A` after every edit; verified `git diff`
  (unstaged) empty, `git show :src/common/http/exception.filter.ts` contains the
  allowlist+redaction filter, `git show :src/app.module.ts` contains
  `APP_FILTER`/`APP_PIPE`, integration spec shows all 5 tests. Round 6 re-verified:
  26 files staged, zero untracked, index == worktree.
- Pattern doc `listen(0)` sweep completed: source-of-truth line, Step-5 snippet
  regenerated from the real harness (address narrowing guard without `as`,
  `baseUrl = ''`, both hooks `15_000`, `listen(0, '127.0.0.1')`), prose key point.
  Dead `AddressInfo` type import removed from harness + doc; Step-4 snippet now
  carries `{ cause: error }` (the filter's `cause=` logging depends on it).
- Filter hardening: `CREDENTIALS_IN_URL` → `/\/\/[^\s/]+@/g` (greedy to the last `@`
  before any slash — passwordless userinfo and `@`-in-password now covered) and a
  leading-slash guard on `new URL(target).pathname` (mailto-style targets → `/`).
- Spec coverage added: stack/message-arg redaction, origin-form userinfo
  line redaction (exercises the `line.replace` defense-in-depth branch), exact-line
  assertions for bare-host/mailto targets, no-method/no-url fallback (`- / -> 500`),
  and `toHaveLength` guards on every spy read so no spec can pass vacuously.
- Doc drift closed: pattern doc volatile test counts replaced with count-free wording
  (they rotted 16→40 across rounds), `useGlobal*` sentence reworded (main.ts has no
  `useGlobal*` since round 2), environments.md variable enumeration now includes
  `HOST`, plan "15 specs" made count-free.
- **Known limitation accepted:** log redaction targets URL-shaped `//userinfo@` forms;
  bare `user:pass@host` text without `//` is logged verbatim (low risk — DSNs arrive
  URL-shaped; revisit if pino redaction lands at T045).

**Final gates (round 6):** `bun run validate` exit 0 · `bun test` **41 pass / 0 fail**
(4 files, 99 expects) · `docker compose config -q` exit 0 · dev smoke live 200 /
ready 200 on `127.0.0.1:3000` loopback · index == worktree, no untracked files.

**Next:** `/pwf-commit-changes` with task prefixes `[T001]`–`[T007]` (never auto-commit).
