# Architecture

Source of truth for system architecture, technology choices, and safe-change guidance.
The challenge specification is `../README.md`; decisions are recorded here (and in
[decisions/](decisions/) as ADRs when created). Status: **spec-only — no application
code yet**; technology choices are decided but not yet implemented (execution plan +
clarifications, 2026-10-06).

**Graded deliverable note:** the challenge grades a root-level `ARCHITECTURE.md`
(spec §14 documentation points; §2 and §4 also reference it by name). This file is the
working source of truth — the root `ARCHITECTURE.md` is created before delivery
(plan T053, Phase 9) as the graded artifact (a decisions/trade-offs summary linking
here as the full source of truth) and kept in sync with this file (plan T054).

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

Decisions (source: execution plan + clarifications):

| Choice | Options in spec | Decision |
|---|---|---|
| ORM | MikroORM (preferred) or TypeORM | ✅ **MikroORM** (explicit UoW, `transactional()`, `LockMode`) |
| Concurrency strategy | pessimistic lock / optimistic lock + retry / conditional update | ✅ **Pessimistic row lock** (`FOR UPDATE` on wallet row inside the tx, scope = `walletId`); `version` incremented on balance change for observability |
| Authentication | external IdP (e.g. Keycloak, Zitadel) or documented no-op extension point | ✅ **Keycloak** (OIDC JWT via JWKS; health + `/metrics` open) |
| Root `ARCHITECTURE.md` | graded artifact required by spec §14 vs. this file as canonical — sync strategy | ✅ **Root summary** (see Graded deliverable note above); sync at plan T053/T054 |

Legend: ✅ = decided 2026-10-06, **not yet implemented** — flip these annotations to
"implemented" at plan T054.

## Module and Service Boundaries

| Module | Responsibility | Must not |
|---|---|---|
| HTTP controllers | validate/transport, map status codes | contain business rules |
| SQS consumer | envelope handling, inbox dedup, ack lifecycle | duplicate the use case logic |
| Use case (application service) | orchestrate domain + persistence atomically | bypass domain factories |
| Domain aggregates | money math, state transitions, invariants | depend on ORM/Nest decorators |
| Persistence layer | repositories, migrations, constraints | weaken schema guarantees |
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
  `PENDING_REFERENCE`; scheduled worker retries with backoff, then rejects with a
  distinct `failureCode`.
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
