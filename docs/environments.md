# Environments

Source of truth for the environment matrix, configuration/secret boundaries,
deployment differences, and operational access. Status: only `local` is defined by
the spec; other environments are pending decisions.

## Environment Matrix

| Aspect | local | dev | staging | prod |
|---|---|---|---|---|
| Purpose | development + integration/concurrency tests | shared integration testing | pre-production validation | production |
| Runtime | Docker Compose (PostgreSQL + LocalStack/MiniStack) + Bun | not defined yet | not defined yet | not defined yet |
| Data | disposable, seeded | synthetic only | synthetic only | real |
| Status | primary environment for this project | pending decision | pending decision | pending decision |

## Configuration and Secrets Boundaries

- **Local**: all values non-secret, defined in `.env` / compose files; LocalStack
  credentials are well-known defaults. Never commit real secrets.
- **Non-local**: secrets come from the chosen provider's secret store (record the
  store in [infrastructure.md](infrastructure.md) when decided) — never from repo
  files or image layers.
- Rule: configuration is injected via environment variables; the app reads no
  hardcoded endpoints or credentials.
- Boundary: business config (timeouts, retry/attempt limits, backoff) vs. secrets
  (DB credentials, IdP client credentials, queue credentials) must be listed here once
  the implementation exists.

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
