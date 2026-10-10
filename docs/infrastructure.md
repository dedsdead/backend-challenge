# Infrastructure

Source of truth for runtime topology, deployment model, and operational constraints.
Facts reflect the challenge specification (`../README.md`) as realized through
Phases 1–5 of `plans/20261006111327-full-wagering-processor-plan.md`
(Foundation & Local Stack, Domain Core & Events, Persistence & Schema, Use Case &
HTTP API, Concurrency Hardening — all marked ✅ Completed; Phase 3 schema applied
to the local database 2026-10-07; Phase 5 concurrency suite passing 2026-10-08).
Status: **foundation + persistence + HTTP API + concurrency hardening + SQS
ingestion/workers + auth/observability + resilience suite implemented (Phases 1–9;
Phase 9 completed 2026-10-09)** — the repo contains the NestJS 12 / Bun application
(`src/`, `tests/`),
`docker-compose.yml` (PostgreSQL 16, LocalStack 4.13.1, Keycloak 26.8), validated
env config, MikroORM 7.2.4 entities + repositories, migration 001 applied to the
local database, the wallet/wagering modules `src/modules/` (2026-10-08), the
**concurrency test suite** (`tests/concurrency/` — hot-wallet, duplicate-flood,
multi-instance, distinct-wallets-parallel, restart-consistency-sweep tests), the SQS consumer + outbox publisher + pending-reference
worker (`src/messaging/`, `src/workers/`, Phases 6–7), the global auth guards
(`src/auth/`), the observability surface (`src/observability/` — pino
logging, correlation middleware, `GET /metrics`), and the **crash-recovery integration
tests** (`tests/integration/crash-recovery.spec.ts`) plus **idempotency edge unit tests**
(`tests/unit/common/idempotency/payload-hash.spec.ts`). No cloud IaC
exists and cloud/provider topology is still undecided; Phase 9 (graded docs) is
complete. Record further realized
decisions in place as implementation lands.

## Infrastructure Overview

- **Model**: local-first. The only defined environment runs on the developer machine
  via Docker Compose; cloud/provider topology is undecided and must be recorded here
  when chosen (AWS/Azure/GCP/VPS/on-prem — none selected yet).
- **Runtime**: Bun 1.4.2 (`engines.bun >= 1.4.2` in `package.json`), NestJS 12.1.2,
  TypeScript strict, MikroORM 7.2.4 (`@mikro-orm/*` + `@mikro-orm/nestjs` 7.1.0).
- **Purpose**: process provider wagering operations with financially correct,
  multi-instance-safe effects persisted in PostgreSQL and published via SQS.

## Environments

| Environment | Provider | Provisioning | Status |
|---|---|---|---|
| local | Docker Compose on developer machine | `docker-compose.yml` at repo root | implemented 2026-10-06 (Phase 1) — three containers healthy; schema applied 2026-10-07 (Phase 3) |
| dev / staging / prod | not defined | not defined | pending decision — fill in when decided |

Required local services: spec §4 mandates PostgreSQL and AWS SQS via **LocalStack** or
**MiniStack** — **LocalStack chosen** (pinned `4.13.1` in `docker-compose.yml`);
Keycloak is added by decision (see Core Services). Details per
environment: [environments.md](environments.md).

Local containers (observed names, project = directory name): `backend-challenge-postgres-1`,
`backend-challenge-localstack-1`, `backend-challenge-keycloak-1` — all ports bound to
`127.0.0.1` only (5432 / 4566 / 8080).

## Core Services and Dependencies

| Service | Role | Notes |
|---|---|---|
| NestJS app (Bun 1.4.2, NestJS 12.1.2) | HTTP API + SQS consumer + workers | must be correct with **3+ concurrent instances**; scaffold, domain, persistence, and the HTTP API implemented (Phases 1–4), SQS consumer + workers (Phases 6–7), auth guards + observability (Phase 8) |
| PostgreSQL | system of record | wallets, ledger, inbox, outbox, idempotency; local image `postgres:16`, host `127.0.0.1:5432`, `postgres`/`local`, db `wagering`; schema owned by migration 001 (see Deployment and Operations) |
| MikroORM 7.2.4 | ORM + migrator | entities in `src/database/entities/`, config `src/database/mikro-orm.config.ts`, migrations `src/database/migrations/`; wired into Nest DI via `MikroOrmModule.forRootAsync` in `src/app.module.ts` |
| Keycloak (local IdP) | OIDC token issuer for the HTTP API | local container: `quay.io/keycloak/keycloak:26.8`, `start-dev --import-realm`, port 8080, realm import from `keycloak/realm-export.json` — **fully configured** since Phase 8 (T043): realm `wagering`, realm roles `transact:read`/`transact:write`, clients `wagering-api` (bearer-only, audience) + `wagering-cli` (public, direct grant), 4 test users (password `wagering-dev-123`), 11 client scopes; validated by `tests/unit/keycloak/realm-export.spec.ts` + live token fetch (`tests/helpers/keycloak-token.ts`). JWT/JWKS validation is done by the app (`src/auth/jwt.guard.ts`, `src/auth/roles.guard.ts`), **not** by Keycloak probing; **not** probed by readiness (clarifications). Realm re-import happens only when the container is (re)created — `--import-realm` skips an existing realm, so `docker compose up -d --force-recreate keycloak` (or `docker compose down` first) after editing the realm file |
| AWS SQS FIFO | ingress + egress messaging | `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (spec §10); broker runs locally (LocalStack 4.13.1, port 4566, `SERVICES=sqs`); queues created with the idempotent `bun run queue:setup` (`scripts/create-queues.ts`, `MAX_RECEIVE_COUNT=5`, Phase 6) |
| Outbox publisher worker | publishes events post-commit | implemented (`src/workers/outbox-publisher.worker.ts`, Phase 7): multi-publisher safe, backoff retry, records the `wagering_outbox_lag` gauge (T046) |
| `PENDING_REFERENCE` worker | reprocesses out-of-order refs | implemented (`src/workers/pending-reference.worker.ts`, Phase 7): scheduled, exponential backoff, TTL (spec §7.1); its columns (`reference_attempts`, `reference_next_attempt_at`) already exist in migration 001 |
| Health endpoints | `GET /health/live`, `GET /health/ready` | implemented (Phase 1, `@Public()` in `src/health/health.controller.ts`, honored by the global guards since Phase 8); readiness checks PostgreSQL (`SELECT 1` via the injected MikroORM `EntityManager`) **and** the SQS queue probe (`SQS_PROBER` / `src/health/sqs-prober.ts`, T047) → body `{postgres:'ok', sqs:'ok'}` — Keycloak excluded (clarifications); unauthenticated |

## Deployment and Operations

- **Local bring-up** (PowerShell; all commands verified 2026-10-07):

  ```powershell
  docker compose up -d --wait          # postgres + localstack + keycloak, waits on healthchecks
  copy .env.example .env               # once; .env is gitignored
  bun run mikro-orm migration:up --config src/database/mikro-orm.config.ts
  bun run queue:setup                  # idempotent; creates wager-transactions.fifo + DLQ (Phase 6)
  bun run dev                          # app on 127.0.0.1:3000 (HOST/PORT from .env)
  ```

  Local gotcha: compose PostgreSQL takes host port 5432 — a native PostgreSQL Windows
  service (e.g. PostgreSQL 18, `postgresql-x64-18`) occupying that port must be stopped
  first; Docker keeps 5432 and `DATABASE_URL` stays `localhost:5432`.
- **Image pins**: LocalStack `4.13.1` (LocalStack 2026.9.0+ refuses to start
  without `LOCALSTACK_AUTH_TOKEN`) and Keycloak `26.8` (the floating tag `26` is not
  published); bump only after re-verifying the healthchecks in `docker-compose.yml`.
- **Shutdown**: on `SIGTERM`, finish in-flight messages or return SQS visibility;
  ack only after SQL commit — shutdown hooks enabled (`app.enableShutdownHooks()`
  in `src/main.ts`); the consumer's drain/stop behavior lives in
  `src/messaging/wager-transaction.consumer.ts` (Phase 6).
- **Remote deployment**: not defined — document flow in
  [environments.md](environments.md) (Deployment Differences) when chosen.

### Database and migrations

- **Wiring**: `src/app.module.ts` calls `MikroOrmModule.forRootAsync` with
  `driver: PostgreSqlDriver`; the factory spreads `mikroOrmConfig` from
  `src/database/mikro-orm.config.ts` and overrides connection values from Nest's
  `ConfigService` (`DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`,
  `DATABASE_HOST`, `DATABASE_PORT`). Entities: `wallet`, `wager_transaction`,
  `wallet_ledger_entry`, `inbox_message`, `outbox_message`.
- **Migrator settings** (`src/database/mikro-orm.config.ts`): migrations path
  `./src/database/migrations`, table `mikro_orm_migrations`, `transactional: true`,
  `allOrNothing: true`, `disableForeignKeys: false`, `emit: 'ts'`, `debug: false`
  (the exported-but-unused `createMikroORM()` helper instead gates `debug` on
  `NODE_ENV === 'development'` — see Deferred gaps), `allowGlobalContext: false`.
- **CLI commands** (via the `mikro-orm` script in `package.json`; verified in
  PowerShell):

  ```powershell
  bun run mikro-orm migration:list   --config src/database/mikro-orm.config.ts
  bun run mikro-orm migration:up     --config src/database/mikro-orm.config.ts
  bun run mikro-orm migration:check  --config src/database/mikro-orm.config.ts
  bun run mikro-orm migration:down   --config src/database/mikro-orm.config.ts
  bun run mikro-orm migration:create --config src/database/mikro-orm.config.ts
  ```

  `--config src/database/mikro-orm.config.ts` is **mandatory**: the CLI only probes
  `./src/mikro-orm.config.ts` / `./mikro-orm.config.ts` (and `.js` variants) and fails
  with "MikroORM config file not found" otherwise.
- **Migration chain**: four migrations in `src/database/migrations/`.
  (001) `Migration20261007000000_InitialMigration.ts` creates the extensions
  (`uuid-ossp`, `pgcrypto`), the five domain tables plus
  `mikro_orm_migrations`, all unique indexes (including the partial
  `uq_wager_tx_reference_kind` on `(reference_transaction_id, kind) WHERE status =
  'PROCESSED'`), the CHECK constraints (`ck_wallet_balance_non_negative`,
  `ck_wager_tx_ref_required`, `ck_ledger_balanced`), and the ledger immutability
  trigger `trg_wallet_ledger_entry_immutable` (function `raise_immutable()`).
  `down()` drops the trigger, function, and the five domain tables but deliberately
  does **not** drop `mikro_orm_migrations` (migrator-owned; comment in the migration).
  (002) `Migration20261008055955_AddLedgerKeysetIndex.ts` adds
  `idx_ledger_wallet_created_id (wallet_id, created_at, id)` for ledger keyset
  pagination; (003) `Migration20261008124755_AddWagerTransactionStatusIndexes.ts`
  adds `idx_wager_tx_status` and `idx_wager_tx_status_ref_next_attempt`
  `(status, reference_next_attempt_at)` for status scans and pending-reference due
  queries; (004) `Migration20261009001637.ts` adds `outbox_message.event_id`
  (add nullable → backfill from `id` → `set not null`).
- **Discipline**: every schema change is an atomic chain — `migration:create` from the
  entity diff → review the generated SQL → `migration:up` against local compose PG →
  `migration:check` must report no drift (plan T020; the same chain applies to
  every later migration — T039's review correctly reported "No changes required"
  instead of creating an empty migration). Schema changes go through migrations only; do not push entity metadata to
  the database with schema-update/schema-push tooling.
- **Trigger ownership**: `src/database/mikro-orm.config.ts` sets
  `schemaGenerator: { ignoreTriggers: true }`. Triggers are owned by migration 001, not
  by entity metadata — otherwise `migration:check` reports drift that must never be
  "fixed" by dropping the trigger.
- **Schema snapshots**: the schema snapshot `src/database/migrations/.snapshot-wagering.json`
  is a per-database cache written next to the migrations and is gitignored
  (`.gitignore` → `.snapshot-*.json`). Never commit it; each machine regenerates it.
- **Validated round-trip** (2026-10-07, local compose PG): `migration:up` →
  `migration:check` ("No changes required, schema is up-to-date", exit 0) →
  `migration:down` → `migration:up` → `migration:check`, all exit 0;
  `migration:list` shows 001 executed at `2026-10-07T16:46:15.935Z`. The same
  up/down round-trip is asserted in `tests/integration/schema.spec.ts` against a
  scratch schema (and verifies `mikro_orm_migrations` survives `down()`).
- **Env contract**: `.env.example` (committed template; `.env` gitignored) +
  `src/config/env.validation.ts` (class-validator, run by
  `ConfigModule.forRoot({ validate: validateEnv })`). `DATABASE_URL` is **required**
  (`postgres://` or `postgresql://`) alongside `SQS_ENDPOINT`, `SQS_QUEUE_URL`,
  `SQS_DLQ_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `PORT`, `HOST` (only
  `127.0.0.1` or `0.0.0.0`), `LOG_LEVEL`, `WORKERS_ENABLED`. **Known split**: the ORM
  never parses `DATABASE_URL` — it connects through discrete `DATABASE_HOST` /
  `DATABASE_PORT` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` whose
  defaults already match local compose (`localhost`, `5432`, `postgres`, `local`,
  `wagering`). Changing only `DATABASE_URL` therefore does not move the ORM. Contract
  cleanup is **still open** — Phase 4 (2026-10-08) closed without consolidating it
  (see Deferred gaps); do not remove the required
  `DATABASE_URL` unilaterally.

### Tests and verification

- **Commands**: `bun run validate` (tsc --noEmit), `bun test`,
  `bun run test:unit`, `bun run test:integration`, `bun run test:concurrency`.
- **Integration suites run against the live local compose PostgreSQL**:
  `tests/integration/schema.spec.ts` connects directly with the local credentials
  (`postgres`/`local`@`localhost:5432/wagering`); `tests/integration/bootstrap.spec.ts`
  boots `AppModule` with a `DATABASE_URL` default. Start the stack first
  (`docker compose up -d --wait`). Treat the local database as disposable — these
  suites insert and delete rows.
- **Token-based suites (Phase 8)**: the authenticated HTTP suites
  (`tests/integration/{wallets.http,wagering.http,http-api,auth-observability}.spec.ts`)
  fetch real Keycloak tokens through `tests/helpers/keycloak-token.ts`
  (direct grant against `http://localhost:8080/realms/wagering`, client
  `wagering-cli`, 4 realm users, cached until shortly before expiry) — so
  Keycloak must be up **with the realm imported**, not just Postgres/LocalStack.
  `auth-observability.spec.ts` also captures pino output through an in-memory
  destination to assert log redaction.
- **Ledger cleanup uses `TRUNCATE TABLE wallet_ledger_entry`**: `DELETE`/`UPDATE` are
  blocked by `trg_wallet_ledger_entry_immutable`, and row triggers do not fire on
  `TRUNCATE` (asserted in `tests/integration/schema.spec.ts`,
  `tests/integration/repositories.spec.ts`,
  `tests/integration/entities/wallet-ledger-entry.entity.spec.ts`).
- **Evidence 2026-10-07** (Phase 3, compose stack healthy): `bun run validate` exit 0;
  `bun test` 200 pass / 0 fail across 19 files; migration round-trip exit 0
  (commands above).
- **Evidence 2026-10-08** (Phase 4): `bun run validate` exit 0; `bun test`
  **353 pass / 0 fail** across 31 files (1222 expects); `docker compose ps` →
  postgres / localstack / keycloak `Up (healthy)` (plan Execution Log).
- **Evidence 2026-10-08** (Phase 5): `bun run validate` exit 0; `bun test`
  **357 pass / 0 fail** across 33 files; `bun run test:concurrency` **3 pass / 0 fail**
  (hot-wallet, duplicate-flood, multi-instance); `docker compose ps` →
  postgres / localstack / keycloak `Up (healthy)` (plan Execution Log).
- **Evidence 2026-10-09** (Phase 9, resilience suite + graded docs): `bun run validate`
exit 0 (run with `$env:GOMEMLIMIT='1200MiB'`); unit **256 pass / 0 fail (26 files)**;
every integration suite green run individually (`auth-observability` 13,
`wallets.http` 23, `wagering.http` 23, `http-api` 8, `bootstrap` 6, `metrics` 3,
`sqs-ingress` 7, `submit-transaction.use-case` 27, `workers` 4,
`outbox-publisher` 2, `pending-reference` 5, `repositories` 10, `schema` 25,
`wallets.service` 7); concurrency **10 pass / 0 fail (4 files)** —
`hot-wallet.spec.ts`, `duplicate-flood.spec.ts`, `multi-instance.spec.ts`,
`spec-section13.spec.ts`; Keycloak realm spec **8 pass**;
live tokens verified for all 4 realm users; crash-recovery integration tests pass;
idempotency edge unit tests pass.
- **Gap resolved**: `bun run test:concurrency` now passes — `tests/concurrency/`
contains `hot-wallet.spec.ts`, `duplicate-flood.spec.ts`, `multi-instance.spec.ts`,
`spec-section13.spec.ts` proving correctness under real parallelism (Phases 5 + 9).

### Source-of-truth references

| Concern | Source of truth | Status |
|---|---|---|
| IaC | none (cloud) | record here when introduced |
| Container definitions | `docker-compose.yml` (repo root) | Postgres 16, LocalStack 4.13.1, Keycloak 26.8; healthchecks on all three; ports on loopback |
| Env contract | `.env.example` (committed template; `.env` gitignored) + `src/config/env.validation.ts` | implemented 2026-10-06; `DATABASE_URL` vs discrete `DATABASE_*` split known (Deferred gaps) |
| Schema + migrations | `src/database/migrations/` + `src/database/mikro-orm.config.ts` | migration 001 applied 2026-10-07; `migration:check` must stay clean |
| DI wiring | `src/app.module.ts` (`MikroOrmModule.forRootAsync`) | implemented (Phase 1, extended Phase 3) |
| Deploy scripts | none | — |
| Console-managed resources | none known | — |
| Queue/broker config | spec §10 (`../README.md`) + `scripts/create-queues.ts` | broker container up; queues created idempotently by `bun run queue:setup` (Phase 6) |

## Known Constraints and Risks

- No event published before the financial commit (outbox) — violating this is an
  eliminatory failure (spec §14).
- Ledger rows immutable: no UPDATE/DELETE on financial records — enforced in the
  database by `trg_wallet_ledger_entry_immutable` (verified live); tests and any
  future maintenance must use `TRUNCATE` for cleanup.
- Idempotency must be persisted; in-memory dedup is an eliminatory failure.
- Money never stored/computed as `number`/float/double (all money columns are
  `numeric(20,2)`).
- Broker ordering/dedup (FIFO) is an optimization only — the database enforces
  invariants; SQS and PostgreSQL must be assumed temporarily unavailable.
- Correctness required with 3+ instances; single-instance-only solutions fail.
- Migrations run before new code serves traffic; `migration:check` reporting drift is
  a failure condition, not a cosmetic warning.
- Local PostgreSQL port conflict: stop any native Windows PostgreSQL service before
  `docker compose up -d` (see Deployment and Operations).
- Integration tests hit the real local database — never point them at a shared
  environment.

### Deferred gaps (open items verified absent — items 1, 2, 4, 5, 7 record resolved decisions kept for numbering)

1. **Ledger keyset-pagination index — resolved (kept for numbering)**: `pageByCursor`
   pages newest-first on `(created_at, id)` per wallet
   (`src/database/repositories/mikro-orm.repositories.ts`); migration 002
   (`Migration20261008055955_AddLedgerKeysetIndex.ts`) added
   `idx_ledger_wallet_created_id (wallet_id, created_at, id)`, covering the hot path
   behind `GET /wallets/:walletId/ledger` (Phase 4).
2. **`PENDING_REFERENCE` recovery index — resolved (kept for numbering)**:
   `findPendingReferenceDue` filters `status = 'PENDING_REFERENCE'` with
   `reference_next_attempt_at IS NULL OR <= at`; migration 003
   (`Migration20261008124755_AddWagerTransactionStatusIndexes.ts`) added
   `idx_wager_tx_status` and `idx_wager_tx_status_ref_next_attempt`
   `(status, reference_next_attempt_at)` (the filter columns). The columns
   themselves were already in migration 001.
3. **`DATABASE_URL` vs discrete `DATABASE_*` contract cleanup**: `DATABASE_URL` is
   required by validation but unused by the ORM; discrete vars/defaults do the actual
   connecting. Still open — Phase 4 (2026-10-08) closed without consolidating it;
   do it in a later phase (do not silently drop the required `DATABASE_URL`).
4. **SQS queues — resolved (Phase 6; kept here for numbering)**: both
   `wager-transactions.fifo` / `wager-transactions-dlq.fifo` are created by the
   idempotent `bun run queue:setup` (`scripts/create-queues.ts`, `MAX_RECEIVE_COUNT=5`);
   re-run it whenever the `localstack-data` volume is recreated
   (`docker compose down -v`) before the SQS suites.
5. **Workers + SQS readiness — resolved (Phases 6–8; kept here for numbering)**:
   `WORKERS_ENABLED` (default `true`) is read by the consumer
   (`src/messaging/messaging.module.ts`) and both workers
   (`src/workers/outbox-publisher.worker.ts`, `src/workers/pending-reference.worker.ts`);
   health readiness now probes PostgreSQL **and** SQS
   (`{postgres:'ok', sqs:'ok'}`, `src/health/sqs-prober.ts`, T047). Keycloak stays
   out of readiness (clarifications).
6. **No foreign-key constraints** — verified against the live DB: `pg_constraint`
   contains only CHECK and PK constraints (no `contype = 'f'`); migration 001 declares
   no `REFERENCES` clauses, while plan T018 describes
   `wallet_ledger_entry.wallet_id`/`transaction_id` as FK. Whether the omission is a
   deliberate app-level-integrity choice or plan drift is **not verified** — confirm
   before relying on DB-enforced referential integrity.
7. **EM/DI scope — decided in Phase 4 (pinned; no longer open — kept here for
   numbering)**: services inject the root `EntityManager` as a transaction factory
   (`@Inject(EntityManager)`), repositories are constructed **per transaction**
   inside `em.transactional(...)` (never shared singletons), `allowGlobalContext`
   stays `false`, and even reads run inside short transactions. Do not "unwrap"
   reads from transactions — that would contradict the pinned decision (plan
   Execution Log, 2026-10-08).
8. **Unused artifacts** — the `createMikroORM()` export in
   `src/database/mikro-orm.config.ts` and the devDependency `@oxc-node/core` are
   unreferenced; remove or wire up later (plan Execution Log).
