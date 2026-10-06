# Decisions

Architecture Decision Records (ADRs): one file per significant decision, named
`YYYY-MM-DD-<slug>.md`.

## Index

| Date | Decision | Status |
|---|---|---|
| _No decisions recorded yet — add a row when creating an ADR._ | | |

## Conventions

- One decision per file; created via `/pwf-doc adr <decision>`.
- Stable headings: Context, Decision, Consequences, Alternatives Considered.
- Status vocabulary: `proposed`, `accepted`, `superseded by <file>`, `deprecated`.
- Accepted decisions that affect architecture, infrastructure, or contracts must be
  reflected in [../architecture.md](../architecture.md),
  [../infrastructure.md](../infrastructure.md), or
  [../integrations.md](../integrations.md).
- Never delete a superseded ADR — mark it superseded and link the replacement.
