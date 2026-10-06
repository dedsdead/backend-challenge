---
description: "Create or refresh the project's foundation documentation set in docs/: infrastructure, architecture, integrations, environments, and glossary. Prevents drift by updating existing files instead of creating duplicates."
---

# Build Foundation Documentation

Use this command to establish or refresh the core project documentation baseline.
This command is project-agnostic by design: it captures what exists in the target project.

## Scope

<doc_foundation_scope> $ARGUMENTS </doc_foundation_scope>

If empty, default to `all`.

Supported targets:

- `all`
- `infrastructure` -> `docs/infrastructure.md`
- `architecture` -> `docs/architecture.md`
- `integrations` -> `docs/integrations.md`
- `environments` -> `docs/environments.md`
- `glossary` -> `docs/glossary.md`

## Workflow

1. Resolve target(s) from arguments.
2. For each target doc, run anti-drift preflight:
   - check whether the canonical file already exists,
   - if it exists, update in place,
   - do not create alternate duplicates like `*-v2.md` or extra copies in other folders.
3. Read relevant project code/docs context before writing:
   - existing docs in `docs/`,
   - project structure and deployment/config patterns,
   - known contracts/integrations/environment settings.
4. Use dedicated agents when available:
   - `infrastructure` -> read and execute `.opencode/agents/docs/infrastructure-doc-writer.md` instructions
   - `architecture` -> read and execute `.opencode/agents/docs/architecture-doc-writer.md` instructions
   - `integrations`, `environments`, `glossary` -> write/update directly in canonical files
5. Write/update docs with concrete source-of-truth references and invariants.
6. Cross-check consistency across the full foundation set.
7. If project `README.md` is missing/stale after major foundation updates, optionally read and execute `.opencode/agents/docs/readme-writer.md` instructions to keep onboarding docs aligned.

## Required minimum sections

### `docs/infrastructure.md`
- `Infrastructure Overview`
- `Environments`
- `Core Services and Dependencies`
- `Deployment and Operations`
- `Known Constraints and Risks`

### `docs/architecture.md`
- `System Overview`
- `Technology Stack`
- `Module and Service Boundaries`
- `Data and Request Flows`
- `Architecture Invariants`

### `docs/integrations.md`
- `Integration Catalog`
- `Authentication and Access`
- `Contracts and Data Flows`
- `Failure Modes and Retries`
- `Ownership`

### `docs/environments.md`
- `Environment Matrix`
- `Configuration and Secrets Boundaries`
- `Deployment Differences`
- `Operational Access`

### `docs/glossary.md`
- `Domain Terms`
- `Technical Terms and Acronyms`
- `Naming Conventions`

## Output

Report:

- targets processed,
- files created vs updated,
- key conflicts found and resolved,
- follow-up recommendations.

## Next Recommended Commands

- `/pwf-doc-runbook <service-or-operation>` to document operational procedures
- `/pwf-doc update` for full cross-doc consistency scan
- `/pwf-work` or `/pwf-work-plan` to continue implementation using updated docs
