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
| Status | primary environment for this project; stack implemented in Phase 1 (2026-10-06): three containers + env validation + health endpoints; realm config and JWT auth planned (plan T043/T044) | pending decision | pending decision | pending decision |

## Configuration and Secrets Boundaries

- **Local**: all values non-secret, defined in `.env` / compose files; the committed
  template `.env.example` enumerates every variable the app requires, `.env` itself
  is gitignored, and LocalStack credentials are well-known defaults. Never commit
  real secrets.
- **Non-local**: secrets come from the chosen provider's secret store (record the
  store in [infrastructure.md](infrastructure.md) when decided) — never from repo
  files or image layers.
- Rule: configuration is injected via environment variables; the app reads no
  hardcoded endpoints or credentials — enforced at boot by
  `src/config/env.validation.ts` (class-validator; startup fails on invalid/missing
  values).
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

Current state (Phase 1, 2026-10-06): health endpoints behave as tabulated; structured
(pino) logging, `GET /metrics`, and the required log fields are **not wired yet** —
`pino`/`prom-client` are installed but unused, planned in plan T045/T046.
Prerequisite: `bun test` boots the app against the local Docker stack — run
`docker compose up -d --wait` first (integration specs hit `/health/ready`).
