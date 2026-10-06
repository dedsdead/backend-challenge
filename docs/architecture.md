# Architecture

Source of truth for system architecture, technology choices, and safe-change guidance.
The challenge specification is `../README.md`; decisions made during implementation are
recorded here and in [decisions/](decisions/). Status: **spec-only** — no application
code exists yet, so open choices below are undecided by design.

**Graded deliverable note:** the challenge grades a root-level `ARCHITECTURE.md`
(spec §14 documentation points; §2 and §4 also reference it by name). This file is the
working source of truth — when implementation starts, the root `ARCHITECTURE.md` must
be created as the graded artifact and kept in sync with (or generated from) this file.

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

Open choices (record decision + rationale here and in `decisions/` when made):

| Choice | Options in spec | Decision |
|---|---|---|
| ORM | MikroORM (preferred) or TypeORM | — |
| Concurrency strategy | pessimistic lock / optimistic lock + retry / conditional update | — |
| Authentication | external IdP (e.g. Keycloak, Zitadel) or documented no-op extension point | — |
| Root `ARCHITECTURE.md` | graded artifact required by spec §14 vs. this file as canonical — sync strategy (root stub linking here, or full copy) | — |

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
