# Architecture

Source of truth for system architecture, technology choices, and safe-change guidance.
The challenge specification is `../README.md`; decisions are recorded here (and in
[decisions/](decisions/) as ADRs when created). Status: **foundation, domain,
persistence, HTTP API, concurrency hardening, SQS ingress/egress, outbox publisher,
pending-reference worker, auth + observability, and resilience suite implemented**
(Phases 1–9, 2026-10-06/09) — the NestJS/Bun scaffold (`src/`), local Docker stack
(`docker-compose.yml`), env validation (`src/config/env.validation.ts` +
`.env.example`), health endpoints (`src/health/`), the domain model
(`src/domain/` + integration events in `src/events/`), the persistence layer
(`src/database/` — 5 entities, mappers, repository ports/implementations,
migration 001 applied to the local database 2026-10-07), the use-case/HTTP layer
(`src/modules/wallets/`, `src/modules/wagering/` — atomic submit use case, spec §9
endpoints, pinned error contract in `src/common/http/exception.filter.ts`), the
**concurrency test suite** (`tests/concurrency/` — hot-wallet, duplicate-flood,
multi-instance, distinct-wallets-parallel, restart-consistency-sweep tests
proving correctness under real parallelism) exist and pass tests (Phase 9 baseline
2026-10-09: `bun run validate` exit 0, unit 256 pass / 0 fail (26 files),
integration suites green run individually (14 suites), concurrency 10 pass / 0 fail
(4 files); earlier full-suite snapshot 357 pass / 0 fail across 33 files,
2026-10-08); **SQS ingress/egress, the
outbox publisher, and the pending-reference worker** (`src/messaging/`,
`src/workers/`, Phases 6–7) and **auth + observability** (Phase 8, 2026-10-09 —
global JWT/roles guards in `src/auth/`, pino logging + correlation middleware +
`GET /metrics` in `src/observability/`) are in place; **Phase 9** (graded root
`ARCHITECTURE.md` + doc sync + resilience suite + idempotency edge tests) is
complete (T049–T054).

**Graded deliverable note:** the challenge grades a root-level `ARCHITECTURE.md`
(spec §14 documentation points; §2 and §4 also reference it by name). This file is the
working source of truth — the root `ARCHITECTURE.md` was created at plan T053 (Phase 9)
as the graded artifact (a decisions/trade-offs summary linking
here as the full source of truth) and is kept in sync with this file (plan T054).

## System Overview

Distributed wagering processor accepting provider operations (`BET → WIN | LOSS |
REFUND | ROLLBACK`) over HTTP and SQS, applying them to player wallets with a strictly
consistent, auditable ledger. Delivery is at-least-once; the system must stay correct
under duplication, out-of-order arrival, concurrent processing, and crashes.

Boundaries:

- **Ingress**: HTTP API (`POST /wagering/transactions`, wallet endpoints, queries) and
  SQS consumer — both funnel into the **same use case**.
- **Domain**: `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`,
  `InboxMessage`, `OutboxMessage` — state encapsulated behind private constructors and
  static factories (`create`/`from`/`rehydrate`).
- **Persistence**: PostgreSQL holds all financial state; schema constraints enforce
  uniqueness, immutability, and non-negativity — not application code alone.
- **Egress**: integration events published from a transactional outbox.

## Technology Stack

Prescribed by the spec (not open choices): Bun 1.x, TypeScript strict, NestJS,
PostgreSQL, AWS SQS (LocalStack/MiniStack locally), Docker Compose, versioned
reversible migrations.

Realized in Phase 1 (2026-10-06): Bun 1.4.2 (minimum — 1.3.14 does not apply
`experimentalDecorators`/`emitDecoratorMetadata` on `bun run`, breaking NestJS
constructor DI), TypeScript strict (`tsconfig.json`), NestJS 12.1.2, MikroORM 7.2.4
(driver + `MikroOrmModule` wired in `src/app.module.ts`), PostgreSQL 16, LocalStack
4.13.1 (chosen over MiniStack), Keycloak 26.8 — versions live in `package.json` and
`docker-compose.yml`.

Realized in Phases 2–3 (2026-10-06/07): domain aggregates in `src/domain/`
(`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`,
`OutboxMessage`) with unit tests in `tests/unit/domain/`, integration events in
`src/events/`, and persistence in `src/database/` — entities, `mappers.ts`,
repository ports + implementations (`src/database/repositories/`), and migration
`Migration20261007000000_InitialMigration.ts` (001: CHECK constraints, partial
unique index, ledger immutability trigger) applied to the local database.

Decisions (source: execution plan + clarifications):

| Choice | Options in spec | Decision |
|---|---|---|
| ORM | MikroORM (preferred) or TypeORM | ✅ **MikroORM** (explicit UoW, `transactional()`, `LockMode`) |
| Concurrency strategy | pessimistic lock / optimistic lock + retry / conditional update | ✅ **Pessimistic row lock** (`FOR UPDATE` on wallet row inside the tx, scope = `walletId`); `version` incremented on balance change for observability |
| Authentication | external IdP (e.g. Keycloak, Zitadel) or documented no-op extension point | ✅ **Keycloak** (OIDC JWT via JWKS; health + `/metrics` open) |
| Root `ARCHITECTURE.md` | graded artifact required by spec §14 vs. this file as canonical — sync strategy | ✅ **Root summary** (see Graded deliverable note above); created at T053, synced at T054 |

Legend: ✅ = decided 2026-10-06. Implementation state of these rows after Phase 9
(2026-10-09): **MikroORM** — wired in `src/app.module.ts`, with 5 entities, mappers,
and repository ports/implementations in `src/database/`; migration 001 applied;
`LockMode.PESSIMISTIC_WRITE` used in `WalletRepository.findByIdForUpdate`, called
inside `em.transactional()` by `SubmitTransactionUseCase`
(`src/modules/wagering/submit-transaction.use-case.ts`); under the pinned EM/DI
decision every wallet read also runs in a short transaction (root `EntityManager`
as transaction factory, per-tx repositories — see
[infrastructure.md](infrastructure.md) → Deferred gaps); **pessimistic row lock** —
used by the Phase 4 submit path and **proven under real parallelism by the Phase 5
concurrency suite** (`tests/concurrency/` — hot-wallet, duplicate-flood,
multi-instance, distinct-wallets-parallel, restart-consistency-sweep tests all pass); **Keycloak** — realm fully configured in
`keycloak/realm-export.json` (roles `transact:read`/`transact:write`, clients,
4 users — T043) and enforced by the global JWT/roles guards (`src/auth/`, T044;
health + `GET /metrics` stay `@Public()`); **root `ARCHITECTURE.md`** — created at
T053 (Phase 9) as the graded artifact linking here as full source of truth; synced
at T054. Flip these
annotations to "implemented" at plan T054.

## Module and Service Boundaries

| Module | Responsibility | Must not |
|---|---|---|
| HTTP controllers | validate/transport, map status codes | contain business rules |
| Auth guards (`src/auth/`) | global JWT verification (JWKS, issuer/audience) + realm-role enforcement (`@Roles`), `@Public()` opt-out — fail-closed 401/403 | contain business rules or parse tokens outside `JwtGuard` |
| Observability (`src/observability/`) | pino logging (redaction), correlation-id middleware, `GET /metrics` (Prometheus) | change request/business behavior |
| SQS consumer | envelope handling, ack lifecycle (inbox dedup runs inside the use case, Phase 4) | duplicate the use case logic |
| Use case (application service) | orchestrate domain + persistence atomically (inbox dedup, idempotency replay, wallet lock) | bypass domain factories |
| Domain aggregates (`src/domain/`) | money math, state transitions, invariants | depend on ORM/Nest decorators |
| Persistence layer (`src/database/`) | entities, mappers, repositories (`repositories/`), migrations (`migrations/`), constraints | weaken schema guarantees |
| Outbox publisher | post-commit event publication | publish before commit |
| Reconciliation use case | report ledger vs. balance divergence | silently correct data |

## Data and Request Flows

```
HTTP controller ─┐
                 ├─→ Use case (application service)
SQS consumer  ───┘        │
                          ├─→ Domain (Wallet / WagerTransaction / Money)
                          ├─→ PostgreSQL transaction:
                          │     wallet balance + ledger entry + inbox dedup + outbox event
                          └─→ outbox worker → SQS (event publish, post-commit)
```

- **Idempotent submit**: `Idempotency-Key` + `payloadHash` (canonical JSON) → replay
  returns original result; different payload under same key = conflict.
- **Out-of-order refs**: `REFUND`/`ROLLBACK` without its reference persists as
  `PENDING_REFERENCE` (submit path implemented in Phase 4); the scheduled worker
  retries with backoff, then rejects with a distinct `failureCode` (worker
  implemented in Phase 7: `src/workers/pending-reference.worker.ts`).
- **Reconciliation**: recomputes balance from ledger, reports divergence (never
  silently corrects).

## Architecture Invariants

Global invariants (spec §3, §5):

1. No duplicated credits or debits; no lost confirmed events; balance never negative.
2. `wallet.balance` always equals the balance reconstructed from the ledger.
3. Money never uses `number`/`float`/`double`; decimal strings with scale 2.
4. Idempotency is persisted (inbox / unique constraints), never memory-only.
5. Events publish only after the financial commit (outbox).
6. Ledger rows are append-only.
7. Concurrency unit is `walletId` — no global lock shared by all wallets.
8. Correctness must hold with 3+ application instances.
9. Uniqueness, immutability, and non-negativity are enforced in the **database
   schema**, not only in application code.

Safe-change guidance:

- Changing money arithmetic, status transitions, or schema constraints requires
  re-checking every invariant above plus the concurrency test suite (spec §13).
- Adding a domain transition: explicit aggregate method with documented valid
  transitions; terminal states (`PROCESSED`, `REJECTED`, `FAILED`) never transition.
- New events require an `IntegrationEvent` subclass with `eventType` + `version` on the
  type, plus a matching entry in [integrations.md](integrations.md).
- Schema changes go through versioned reversible migrations; validate constraints in
  the database, not only in code.
