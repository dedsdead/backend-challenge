---
name: docs-baseline-loading
description: "Load and enforce mandatory project documentation baseline before implementation work."
---

# Docs Baseline Loading

Use this skill before implementation commands to guarantee the project docs baseline is present, readable, and aligned.

## Trigger conditions

- Running `/pwf-work`, `/pwf-work-plan`, `/pwf-work-light`, or `/pwf-work-tdd`.
- Starting implementation in a project with missing or stale docs.

## Mandatory baseline docs

- `docs/infrastructure.md`
- `docs/architecture.md`
- `docs/integrations.md`
- `docs/environments.md`
- `docs/glossary.md`

Read these before coding.

## Optional but high-value context docs

- `docs/solutions/patterns/critical-patterns.md` (if exists)
- `docs/modules/<module>.md` when backend/module scope is touched
- `docs/features/<feature>.md` when frontend/UI scope is touched
- `docs/infrastructure/<component>.md` when infrastructure scope is touched
- `docs/runbooks/README.md` when operational/deploy behavior is touched

## If baseline docs are missing

Create missing files immediately before implementation.

### Required minimum sections

`docs/infrastructure.md`:
- `Infrastructure Overview`
- `Environments`
- `Core Services and Dependencies`
- `Deployment and Operations`
- `Known Constraints and Risks`

`docs/architecture.md`:
- `System Overview`
- `Technology Stack`
- `Module and Service Boundaries`
- `Data and Request Flows`
- `Architecture Invariants`

`docs/integrations.md`:
- `Integration Catalog`
- `Authentication and Access`
- `Contracts and Data Flows`
- `Failure Modes and Retries`
- `Ownership`

`docs/environments.md`:
- `Environment Matrix`
- `Configuration and Secrets Boundaries`
- `Deployment Differences`
- `Operational Access`

`docs/glossary.md`:
- `Domain Terms`
- `Technical Terms and Acronyms`
- `Naming Conventions`

## Constraints

- Do not create duplicate variants of baseline docs.
- Update canonical docs in place.
- Keep docs project-specific and operational (no filler).
