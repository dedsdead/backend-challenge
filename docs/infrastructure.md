# Infrastructure

Source of truth for runtime topology, deployment model, and operational constraints.
Facts reflect the challenge specification (`../README.md`) as realized in Phase 1
(2026-10-06). Status: **foundation implemented** — the repo now contains the
NestJS/Bun application (`src/`, `tests/`), `docker-compose.yml` (PostgreSQL 16,
LocalStack 4.13.1, Keycloak 26.8), `.env.example`, and validated env config; no cloud
IaC exists and cloud/provider topology is still undecided. Record further realized
decisions in place as implementation lands.

## Infrastructure Overview

- **Model**: local-first. The only defined environment runs on the developer machine
  via Docker Compose; cloud/provider topology is undecided and must be recorded here
  when chosen (AWS/Azure/GCP/VPS/on-prem — none selected yet).
- **Purpose**: process provider wagering operations with financially correct,
  multi-instance-safe effects persisted in PostgreSQL and published via SQS.

## Environments

| Environment | Provider | Provisioning | Status |
|---|---|---|---|
| local | Docker Compose on developer machine | `docker-compose.yml` at repo root | implemented 2026-10-06 (Phase 1) — all three containers healthy |
| dev / staging / prod | not defined | not defined | pending decision — fill in when decided |

Required local services: spec §4 mandates PostgreSQL and AWS SQS via **LocalStack** or
**MiniStack** — **LocalStack chosen** (pinned `4.13.1` in `docker-compose.yml`);
Keycloak is added by decision (see Core Services). Details per
environment: [environments.md](environments.md).

## Core Services and Dependencies

| Service | Role | Notes |
|---|---|---|
| NestJS app (Bun 1.x) | HTTP API + SQS consumer + workers | must be correct with **3+ concurrent instances**; scaffold implemented (Phase 1), consumers/workers planned |
| PostgreSQL | system of record | wallets, ledger, inbox, outbox, idempotency; local image `postgres:16`, host port 5432, `postgres`/`local`, db `wagering` |
| Keycloak (local IdP) | OIDC token issuer for the HTTP API | local container implemented (Phase 1): `quay.io/keycloak/keycloak:26.8`, `start-dev --import-realm`, port 8080, realm import from `keycloak/realm-export.json` — currently a **placeholder** realm `wagering` (no clients/roles); realm config + OIDC/JWKS guard still planned (plan T043/T044); not probed by readiness (T047) |
| AWS SQS FIFO | ingress + egress messaging | `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (spec §10); broker runs locally (LocalStack 4.13.1, port 4566, `SERVICES=sqs`) but queues are not created yet (plan T034) |
| Outbox publisher worker | publishes events post-commit | multi-publisher safe, backoff retry — planned |
| `PENDING_REFERENCE` worker | reprocesses out-of-order refs | scheduled, exponential backoff (spec §7.1) — planned |
| Health endpoints | `GET /health/live`, `GET /health/ready` | implemented (Phase 1, `@Public()` in `src/health/health.controller.ts`); readiness currently checks PostgreSQL only (`SELECT 1` in `src/health/health.service.ts`) — SQS probe planned (plan T047), Keycloak excluded (clarifications); unauthenticated |

## Deployment and Operations

- **Local**: `docker compose up` starts PostgreSQL (host 5432), LocalStack (SQS,
  4566), and Keycloak (8080, realm imported from `keycloak/realm-export.json`); the
  app runs via `bun run dev` (default port 3000) with `.env` copied from
  `.env.example`. Local gotcha: compose PostgreSQL takes host port 5432 — a native
  PostgreSQL Windows service (e.g. PostgreSQL 18, `postgresql-x64-18`) occupying that
  port must be stopped first; Docker keeps 5432 and `DATABASE_URL` stays
  `localhost:5432`.
- **Image pins**: LocalStack `4.13.1` (LocalStack 2026.9.0+ refuses to start
  without `LOCALSTACK_AUTH_TOKEN`) and Keycloak `26.8` (the floating tag `26` is not
  published); bump only after re-verifying the healthchecks in `docker-compose.yml`.
- **Migrations**: versioned and reversible; run before new code serves traffic —
  none exist yet (MikroORM migration config wired in `src/app.module.ts`, table
  `mikro_orm_migrations`).
- **Shutdown**: on `SIGTERM`, finish in-flight messages or return SQS visibility;
  ack only after SQL commit — shutdown hooks enabled (`app.enableShutdownHooks()`
  in `src/main.ts`); message handling planned with the SQS consumer.
- **Remote deployment**: not defined — document flow in
  [environments.md](environments.md) (Deployment Differences) when chosen.

### Source-of-truth references

| Concern | Source of truth | Status |
|---|---|---|
| IaC | none (cloud) | record here when introduced |
| Container definitions | `docker-compose.yml` (repo root) | created 2026-10-06 (PostgreSQL 16, LocalStack 4.13.1, Keycloak 26.8) |
| Env contract | `.env.example` (committed template; `.env` gitignored) + `src/config/env.validation.ts` | implemented 2026-10-06 (class-validator) |
| Deploy scripts | none | — |
| Console-managed resources | none known | — |
| Queue/broker config | spec §10 (`../README.md`) | prescribed; queue creation pending (plan T034) |

## Known Constraints and Risks

- No event published before the financial commit (outbox) — violating this is an
  eliminatory failure (spec §14).
- Ledger rows immutable: no UPDATE/DELETE on financial records.
- Idempotency must be persisted; in-memory dedup is an eliminatory failure.
- Money never stored/computed as `number`/float/double.
- Broker ordering/dedup (FIFO) is an optimization only — the database enforces
  invariants; SQS and PostgreSQL must be assumed temporarily unavailable.
- Correctness required with 3+ instances; single-instance-only solutions fail.
