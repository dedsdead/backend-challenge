# Decisions

Architecture Decision Records (ADRs): one file per significant decision, named
`YYYY-MM-DD-<slug>.md`.

## Index

| Date | Decision | Status |
|---|---|---|
| 2026-10-06 | MikroORM as ORM | accepted |
| 2026-10-06 | Pessimistic row lock per `walletId` | accepted |
| 2026-10-06 | Keycloak as external IdP (OIDC/JWKS) | accepted |
| 2026-10-06 | Root `ARCHITECTURE.md` = summary linking `docs/architecture.md` | accepted |

All four are recorded in [../architecture.md](../architecture.md) §Technology Stack;
ADR files pending (created via `/pwf-doc adr`).

## Conventions

- One decision per file; created via `/pwf-doc adr <decision>`.
- Stable headings: Context, Decision, Consequences, Alternatives Considered.
- Status vocabulary: `proposed`, `accepted`, `superseded by <file>`, `deprecated`.
- Accepted decisions that affect architecture, infrastructure, or contracts must be
  reflected in [../architecture.md](../architecture.md),
  [../infrastructure.md](../infrastructure.md), or
  [../integrations.md](../integrations.md).
- Never delete a superseded ADR — mark it superseded and link the replacement.
