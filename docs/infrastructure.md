# Infrastructure

Source of truth for runtime topology, deployment model, and operational constraints.
Facts reflect the challenge specification (`../README.md`). Status: **spec-only** — the
repository currently contains `README.md` and `docs/`; no application code, IaC, or
compose files exist yet. Record realized decisions in place as implementation lands.

## Infrastructure Overview

- **Model**: local-first. The only defined environment runs on the developer machine
  via Docker Compose; cloud/provider topology is undecided and must be recorded here
  when chosen (AWS/Azure/GCP/VPS/on-prem — none selected yet).
- **Purpose**: process provider wagering operations with financially correct,
  multi-instance-safe effects persisted in PostgreSQL and published via SQS.

## Environments

| Environment | Provider | Provisioning | Status |
|---|---|---|---|
| local | Docker Compose on developer machine | `docker-compose.yml` at repo root | prescribed by spec; not yet created |
| dev / staging / prod | not defined | not defined | pending decision — fill in when adopted |

Required local services (spec §4): PostgreSQL, AWS SQS via **LocalStack** or
**MiniStack**. Details per environment: [environments.md](environments.md).

## Core Services and Dependencies

| Service | Role | Notes |
|---|---|---|
| NestJS app (Bun 1.x) | HTTP API + SQS consumer + workers | must be correct with **3+ concurrent instances** |
| PostgreSQL | system of record | wallets, ledger, inbox, outbox, idempotency |
| AWS SQS FIFO | ingress + egress messaging | `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (spec §10) |
| Outbox publisher worker | publishes events post-commit | multi-publisher safe, backoff retry |
| `PENDING_REFERENCE` worker | reprocesses out-of-order refs | scheduled, exponential backoff (spec §7.1) |
| Health endpoints | `GET /health/live`, `GET /health/ready` | readiness = PostgreSQL + SQS reachable; unauthenticated |

## Deployment and Operations

- **Local**: `docker compose up` starts PostgreSQL + queue broker; app runs via Bun.
- **Migrations**: versioned and reversible; run before new code serves traffic.
- **Shutdown**: on `SIGTERM`, finish in-flight messages or return SQS visibility;
  ack only after SQL commit.
- **Remote deployment**: not defined — document flow in
  [environments.md](environments.md) (Deployment Differences) when chosen.

### Source-of-truth references

| Concern | Source of truth | Status |
|---|---|---|
| IaC | none | record here when introduced |
| Container definitions | `docker-compose.yml` (repo root) | not yet created |
| Deploy scripts | none | — |
| Console-managed resources | none known | — |
| Queue/broker config | spec §10 (`../README.md`) | prescribed |

## Known Constraints and Risks

- No event published before the financial commit (outbox) — violating this is an
  eliminatory failure (spec §14).
- Ledger rows immutable: no UPDATE/DELETE on financial records.
- Idempotency must be persisted; in-memory dedup is an eliminatory failure.
- Money never stored/computed as `number`/float/double.
- Broker ordering/dedup (FIFO) is an optimization only — the database enforces
  invariants; SQS and PostgreSQL must be assumed temporarily unavailable.
- Correctness required with 3+ instances; single-instance-only solutions fail.
