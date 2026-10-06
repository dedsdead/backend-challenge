# Project Documentation

Source of truth for the Distributed Wagering Processor (Jungle Gaming technical challenge).
Challenge specification lives in [`../README.md`](../README.md); this directory holds the
operational and architectural documentation derived from it.

## Core documents

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | System architecture, stack, module map, invariants |
| [infrastructure.md](infrastructure.md) | Runtime topology, deployment model, IaC references |
| [integrations.md](integrations.md) | External/internal integration catalog and contracts |
| [environments.md](environments.md) | Environment matrix, config/secret boundaries |
| [glossary.md](glossary.md) | Domain and technical terminology |

## Workflow structure

| Directory | Purpose |
|---|---|
| [brainstorms/](brainstorms/) | Discovery notes for new features |
| [plans/](plans/) | Execution-ready plans |
| [work-plans/](work-plans/) | Phase-based work plans with execution logs |
| [solutions/](solutions/) | Solution write-ups; [patterns/](solutions/patterns/) holds reusable patterns |
| [workflow/](workflow/) | Workflow policy and [operational overrides](workflow/operational-overrides.md) |
| [runbooks/](runbooks/) | Operational runbooks and [catalog](runbooks/README.md) |

## Reference indexes

| Directory | Purpose |
|---|---|
| [modules/](modules/) | Per-module backend documentation |
| [features/](features/) | Per-feature frontend documentation |
| [lambdas/](lambdas/) | Per-Lambda documentation |
| [decisions/](decisions/) | Architecture Decision Records (ADRs) |

## Conventions

- Never delete documentation; update it in place.
- Every document uses stable section headings so tooling can append safely.
- Decisions that change architecture, infrastructure, or contracts are recorded in
  `decisions/` and referenced from the relevant core document.
