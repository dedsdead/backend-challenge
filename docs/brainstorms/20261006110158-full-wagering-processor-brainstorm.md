# Brainstorm — Full Wagering Processor

Timestamp: `20261006110158` · Scope: complete challenge spec (`../README.md`) · Status: decisions captured, ready for `/pwf-plan`

## 1. What We're Building

A distributed financial service that processes wagering operations sent by game
providers (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) against per-player wallets,
maintaining a strictly consistent materialized balance and an immutable audit ledger.
It is the entire Jungle Gaming technical challenge: correctness under duplicated,
out-of-order, and concurrent delivery, with persistent idempotency and crash-safe
async processing.

Primary audiences: **game providers** (submitting operations over HTTP or SQS and
receiving stable, machine-readable outcomes), **operators** (reconciling balances,
triaging DLQ/outbox health), and **evaluators** (grading against the rubric in spec
§14). There is no end-user UI and no admin console in scope.

It replaces nothing — this is a greenfield build. It complements the challenge
`README.md` (requirements) and the `docs/` foundation set (architecture,
integrations, infrastructure, environments, glossary).

## 2. Current State

- **Backend code:** none. Repository contains only `README.md`, `.gitignore`,
  `docs/`, `.opencode/`. No `src/`, no `package.json`, no migrations.
- **Frontend:** none in scope (single-page/mobile UI not part of the challenge).
- **Lambdas:** none — the spec's async work runs inside the service (see Key
  Decisions #5).
- **Infrastructure:** no `docker-compose.yml` yet; spec §4 requires Docker Compose
  with PostgreSQL + SQS broker (LocalStack or MiniStack).
- **Documentation already completed:**
  - `docs/architecture.md` — system overview, stack, boundaries, invariants
  - `docs/integrations.md` — HTTP/SQS contracts, events, failure modes
  - `docs/infrastructure.md` — topology, services, constraints
  - `docs/environments.md` — environment matrix (local defined; dev/staging/prod pending)
  - `docs/glossary.md` — domain/technical terminology
- **Prior brainstorms/plans for this area:** none (`docs/brainstorms/`,
  `docs/plans/` empty).
- **Workflow policy in effect:** `docs/workflow/operational-overrides.md`
  (never destructive, create-missing-only, no auto-commit).

## 3. Architecture & Infrastructure

- **Where the logic lives** — a **single NestJS (Bun) service** owning HTTP API,
  SQS consumer, and background workers. Rationale: spec §10 mandates HTTP and SQS
  feed the **same use case**; multi-instance correctness (§8) is graded on the
  service itself; no serverless/Lambda requirement exists. Workers run in-process
  (Key Decision #5).
- **Cloud services / containers** — PostgreSQL (system of record); AWS SQS FIFO
  `wager-transactions.fifo` + `wager-transactions-dlq.fifo` via LocalStack/MiniStack
  locally; Keycloak container for OIDC (auth); no buckets, no CDN, no additional
  queues/events beyond the outbox publisher's targets.
- **Data model** (overview) — 5 tables:
  - `wallet` (unique `player_id + currency`, `balance` exact-numeric, `version`)
  - `wager_transaction` (unique `idempotency_key`, unique
    `provider_id + external_transaction_id`, `payload_hash`, status enum,
    reference fields, `failure_code`)
  - `wallet_ledger_entry` (immutable: direction, money, `balance_before`,
    `balance_after`; no updates/deletes — DB-enforced)
  - `inbox_message` (unique `consumer_name + message_id`, `processed_at`)
  - `outbox_message` (event envelope, `attempts`, `next_attempt_at`, `published_at`)
  - Enums: `WagerTransactionKind`, `WagerTransactionStatus`, `LedgerDirection`.
  - Constraints/uniqueness/non-negativity enforced **in the schema** (spec §5.9).
- **Infrastructure changes** — create `docker-compose.yml` (postgres, localstack,
  keycloak, app), versioned reversible migrations, health endpoints
  (`/health/live`, `/health/ready`).
- **Security approach** — Keycloak OIDC for HTTP endpoints (candidate-chosen per
  §2); health endpoints unauthenticated; SQS treated as trusted internal channel
  with full domain validation of `providerId`; no full financial payloads or secrets
  in logs.

## 4. Integration Impact

- **Entity impact** — all five entities are new; **migration 001** creates the full
  schema (tables, enums, unique/check constraints, indexes for ledger cursor
  pagination, outbox due-scan, and `PENDING_REFERENCE` reprocessing). No existing
  data, no backfill, no lockstep deploy.
- **Lambda pipeline impact** — none (no Lambdas). Equivalent risk sits with the
  in-process **outbox publisher** and **PENDING_REFERENCE reprocessor** running
  concurrently on 3+ instances: they need claim/lease semantics so instances don't
  double-publish or starve rows. Risk level: **high for correctness**, isolated to
  two workers.
- **Frontend feature impact** — none.
- **Breaking changes** — none possible (greenfield). The only "contract freeze"
  is the spec itself: providers depend on §9 endpoints, §10 message shape, and §11
  event envelopes — those are fixed inputs, not migration surface.

## 5. Key Decisions

1. `✅ DECIDED:` **ORM = MikroORM** (spec-preferred) — explicit Unit of Work,
   `EntityManager.transactional()`, `LockMode` map directly onto the single atomic
   SQL transaction (wallet + ledger + inbox + outbox).
2. `✅ DECIDED:` **Concurrency = pessimistic row lock** (`SELECT ... FOR UPDATE` on
   the wallet row, lock scope = `walletId`) inside the transaction; `version`
   still incremented on balance change for observability/optimistic diagnostics.
   Broker FIFO ordering remains an optimization only.
3. `✅ DECIDED:` **Authentication = external IdP (Keycloak)** via Docker Compose,
   OIDC JWT validation on HTTP endpoints; health stays open; queue channel trusted
   but payload fully validated.
4. `✅ DECIDED:` **Currency scope = BRL only**, while `Money` stays multi-currency
   (ISO-4217 field, cross-currency conflict tests still required).
5. `✅ DECIDED:` **Workers in-process** — outbox publisher + `PENDING_REFERENCE`
   reprocessor run inside the NestJS app with claim/lease so 3+ instances
   cooperate; one deployable.
6. `✅ DECIDED:` **Single service, dual ingress** — HTTP and SQS funnel into the
   same use case (spec §10).
7. `✅ DECIDED:` **Inbox + outbox are mandatory**, written in the same SQL
   transaction as the financial change; events publish only post-commit.
8. `✅ DECIDED:` **Queue names** — `wager-transactions.fifo`,
   `wager-transactions-dlq.fifo` (spec §10).
9. `⚠️ OPEN:` **Local broker = LocalStack vs MiniStack** (spec §4 allows either) —
   default recommendation: LocalStack; confirm in plan (low impact).
10. `⚠️ OPEN:` **`failureCode` taxonomy** (spec §7.2 requires a stable,
    machine-readable set; distinct codes needed for insufficient funds vs
    reversal-would-go-negative vs missing reference) — design in plan.
11. `⚠️ OPEN:` **`PENDING_REFERENCE` attempt limit / TTL** (spec §7.1 requires a
    justified limit before terminal `REJECTED`) — pick value + backoff curve in plan.
12. `⚠️ OPEN:` **HTTP status-code mapping** (spec §9 requires consistent
    distinction: invalid payload / idempotency conflict / business rejection /
    accepted-pending / transient infra failure) — choose codes in plan.
13. `⚠️ OPEN:` **`payloadHash` canonicalization** (canonical JSON, key-sorted,
    business fields only, algorithm documented) — specify exact field set in plan.
14. `⚠️ OPEN:` **Money storage representation** (separate `amount` + `currency`
    columns; exact type — e.g. `numeric(20,2)` vs text — never float) — decide with
    migration in plan.

## 6. Open Questions

1. Local broker choice: LocalStack vs MiniStack (default LocalStack).
2. `failureCode` taxonomy — which stable codes, and which map to retryable vs
   terminal outcomes for providers.
3. `PENDING_REFERENCE` retry limit/TTL and backoff curve before terminal rejection.
4. Exact HTTP status codes (and conflict body shape) for the five outcome classes.
5. Canonical-JSON field set + serialization rules behind `payloadHash`.
6. Money column type and scale enforcement in PostgreSQL.
7. Keycloak realm/client configuration details for local dev (seeded realm file).

## 7. Next Steps

- Run **`/pwf-plan docs/brainstorms/20261006110158-full-wagering-processor-brainstorm.md`**
  to convert these decisions into executable phases.
- Deeper investigation during planning:
  - MikroORM lock/transaction semantics for the per-wallet `FOR UPDATE` path and
    how `rehydrate` interacts with locked reads;
  - outbox claim/lease SQL that is safe with concurrent publishers (spec §11
    scenario) and `PENDING_REFERENCE` scheduled reprocessing query;
  - test harness design for real-parallel races (spec §13: 50× parallel submit,
    ≥3 processes, kill-before-ack).
- Prerequisites: Docker (Compose), Bun 1.x, LocalStack + Keycloak images,
  PostgreSQL image — all defined in the not-yet-created `docker-compose.yml`.
- Keep `docs/architecture.md` open choices (#1–#3 table + root `ARCHITECTURE.md`
  sync strategy) aligned with the decisions above during planning.
