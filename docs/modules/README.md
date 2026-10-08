# Modules

Canonical documentation for backend modules (one file per module:
`docs/modules/<module-name>.md`).

## Index

| Module | Description | Status |
|---|---|---|
| [wallets](wallets.md) | Wallet lifecycle, ledger pagination, reconciliation | Phase 4 implemented |
| [wagering](wagering.md) | Transaction submit pipeline (idempotency, locks, references) and status lookups | Phase 4 implemented (HTTP ingress only) |

## Conventions

- One file per NestJS module, named after the module.
- Stable headings: Overview, Responsibilities, Public API, Dependencies, Invariants,
  Testing.
- Generated/maintained via `/pwf-doc module <name>` and post-work doc maintenance.
- Related decisions live in [../decisions/](../decisions/); terminology in
  [../glossary.md](../glossary.md).
