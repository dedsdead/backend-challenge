# Environments

Source of truth for the environment matrix, configuration/secret boundaries,
deployment differences, and operational access. Status: only `local` is defined by
the spec; other environments are pending decisions.

## Environment Matrix

| Aspect | local | dev | staging | prod |
|---|---|---|---|---|
| Purpose | development + integration/concurrency tests | shared integration testing | pre-production validation | production |
| Runtime | Docker Compose (PostgreSQL 16 + LocalStack 4.13.1 + Keycloak 26.8) + Bun 1.4.2 | not defined yet | not defined yet | not defined yet |
| Data | disposable, seeded | synthetic only | synthetic only | real |
| Status | primary environment for this project; implemented Phases 1–9 (2026-10-06/09): three containers + env validation + health endpoints (readiness = PostgreSQL + SQS) + persistence (entities, repositories, migration 001 applied 2026-10-07) + HTTP API (`src/modules/wallets/`, `src/modules/wagering/`, 2026-10-08) + SQS consumer/workers (Phases 6–7) + auth & observability (Phase 8, 2026-10-09: realm `keycloak/realm-export.json` with roles/clients/users, global JWT + roles guards, pino logging with redaction, correlation middleware, `GET /metrics`) + **resilience suite (Phase 9, 2026-10-09: crash-recovery integration tests, §13 remaining concurrency cases, idempotency edge unit tests, graded root `ARCHITECTURE.md`)** | pending decision | pending decision | pending decision |

## Configuration and Secrets Boundaries

- **Local**: all values non-secret, defined in `.env` / compose files; the committed
  template `.env.example` enumerates every variable the app requires, `.env` itself
  is gitignored, LocalStack credentials are well-known defaults, and the Keycloak
  dev credentials (admin `admin`/`admin`; realm users password `wagering-dev-123`,
  seed data in `keycloak/realm-export.json`) are non-secret by design. Never commit
  real secrets.
- **Non-local**: secrets come from the chosen provider's secret store (record the
  store in [infrastructure.md](infrastructure.md) when decided) — never from repo
  files or image layers.
- Rule: configuration is injected via environment variables and validated at boot by
  `src/config/env.validation.ts` (class-validator; startup fails on invalid/missing
  values). **Known exception (still open — Phase 4 closed without fixing it)**: the
  ORM does not consume the
  validated `DATABASE_URL` — `src/database/mikro-orm.config.ts` reads discrete
  `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_USER` / `DATABASE_PASSWORD` /
  `DATABASE_NAME` straight from `process.env`, with local-compose defaults that are
  neither validated nor listed in `.env.example`; changing only `DATABASE_URL` does
  not move the ORM (see [infrastructure.md](infrastructure.md) → Deferred gaps).
- Boundary: business config (timeouts, retry/attempt limits, backoff) vs. secrets
  (DB credentials, IdP client credentials, queue credentials) must be listed here
  once those settings exist. Current variables (all non-secret locally, validated):
  `DATABASE_URL`, `SQS_ENDPOINT`, `SQS_QUEUE_URL`, `SQS_DLQ_URL`,
  `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `PORT`, `HOST`, `LOG_LEVEL`,
  `WORKERS_ENABLED` — see `.env.example`.

## Deployment Differences

| Transition | Trigger | Preconditions |
|---|---|---|
| local → dev | not defined yet | — |
| dev → staging | not defined yet | — |
| staging → prod | not defined yet | — |

Common invariants for any environment: versioned reversible migrations run before
new code serves traffic; health endpoints report readiness before receiving messages;
deploy must tolerate 3+ running instances (rolling, no global downtime assumption).

## Operational Access

| Aspect | local | dev | staging | prod |
|---|---|---|---|---|
| Logs | structured JSON to console | same, aggregated (tool TBD) | same | same |
| Required fields | `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` | + | + | + |
| Sensitive data | never log full financial payloads or secrets | same | same | same |
| Metrics | optional locally | transactions by status, duplicates, retries, DLQ depth, lock conflicts, outbox lag, processing latency | same | same |
| Health | `/health/live`, `/health/ready` | same | same | same |
| Access | developer machine | team | restricted | restricted, audited |

Current state (Phases 1–9, 2026-10-09): health endpoints behave as tabulated
(`/health/ready` returns `{postgres:'ok', sqs:'ok'}`);
persistence (entities, repositories, migration 001 applied to the local database)
is in place; the wallet/wagering HTTP endpoints **require a Keycloak bearer
token** (`transact:write` on POSTs, `transact:read` on GETs — global guards in
`src/auth/`; the integration suites authenticate through
`tests/helpers/keycloak-token.ts`). Structured (pino) logging is wired
(`src/observability/logger.ts`, `PinoLoggerService` booted in `src/main.ts`,
redacting `authorization` headers and `data`/`payload`/`body` paths), every
request is assigned/echoed an `x-correlation-id`
(`src/observability/correlation.ts`, app-wide middleware), and `GET /metrics`
serves the Prometheus registry (`src/observability/metrics.service.ts`, facade
`src/common/metrics/metrics.ts`) with `wageringLockConflictsTotal`,
`wageringTxTotal{processed,rejected,pendingReference}`,
`wageringProcessingSeconds`, plus duplicates, SQS retries, DLQ, reconciliation
divergences and the `wagering_outbox_lag` gauge (T045/T046/T047).
Prerequisite: `bun test` needs the local Docker stack — run
`docker compose up -d --wait` first (Keycloak included: the token suites need the
`wagering` realm imported, not just healthy containers;
`tests/integration/bootstrap.spec.ts` boots
the app and hits `/health/ready`; the Phase 4 suites
`tests/integration/{http-api,wallets.http,wagering.http,wallets.service,submit-transaction.use-case}.spec.ts`
boot the app or hit the same database; `tests/integration/{schema,repositories}.spec.ts` and
`tests/integration/entities/*.spec.ts` read/write the local database directly, so
migration 001 must be applied first:
`bun run mikro-orm migration:up --config src/database/mikro-orm.config.ts`). Treat
the local database as disposable — those suites insert and delete rows.
**Concurrency suite**: `bun run test:concurrency` runs the Phase 5 + 9 tests
(`tests/concurrency/*.spec.ts`) against the live stack — 4 files, 10 tests,
proven correct under real parallelism.
