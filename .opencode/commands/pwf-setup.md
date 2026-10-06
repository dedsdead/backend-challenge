---
description: "Initialize or repair the project workflow skeleton under docs/. Creates required folders, starter README files, .gitkeep markers for empty directories, operational override policy file, required foundation docs, and runbooks structure."
---

# Setup Project Workflow Skeleton

Use this command to bootstrap (or repair) the baseline workflow structure in `docs/`.
This command is intentionally deterministic: it creates missing structure without guessing architecture decisions.

## Goals

1. Ensure `docs/` exists and has a predictable workflow structure.
2. Create missing directories and keep them in git using `.gitkeep` when empty.
3. Ensure project-level operational override file exists:
   - `docs/workflow/operational-overrides.md`
4. Ensure mandatory project baseline files exist:
   - `docs/infrastructure.md`
   - `docs/architecture.md`
   - `docs/integrations.md`
   - `docs/environments.md`
   - `docs/glossary.md`
5. Ensure runbooks structure exists:
   - `docs/runbooks/`
   - `docs/runbooks/README.md`
6. Avoid destructive edits:
   - Never delete existing docs.
   - Never overwrite non-empty existing files unless explicitly requested by the user.

## Important path boundary

Do not redefine this policy inline. Follow the canonical boundary rule in `AGENTS.md (#docs-scope-boundary)`.

When running `/pwf-setup`, always create/update the **project docs** structure defined by that rule.

---

## Required skeleton

Create these directories if missing:

- `docs/`
- `docs/brainstorms/`
- `docs/plans/`
- `docs/work-plans/`
- `docs/solutions/`
- `docs/solutions/patterns/`
- `docs/workflow/`
- `docs/runbooks/`
- `docs/modules/`
- `docs/features/`
- `docs/infrastructure/`
- `docs/decisions/`

For each empty directory above, create `.gitkeep`.

Required files (create if missing):

- `docs/README.md` (index with links to core sections)
- `docs/workflow/operational-overrides.md` (project policy override file)
- `docs/infrastructure.md` (project infrastructure source of truth)
- `docs/architecture.md` (project architecture source of truth)
- `docs/integrations.md` (external systems and contract source of truth)
- `docs/environments.md` (environment matrix and deployment context source of truth)
- `docs/glossary.md` (domain and technical terminology source of truth)
- `docs/runbooks/README.md` (runbooks catalog and usage guide)

Also ensure starter index files exist if missing:

- `docs/modules/README.md`
- `docs/features/README.md`
- `docs/lambdas/README.md`
- `docs/decisions/README.md`

---

## File content policy

When creating missing files:

- Keep content concise and operational.
- Do not add placeholders like "TODO fill later" without concrete guidance.
- Use stable section headings so future commands can append/update safely.

`docs/workflow/operational-overrides.md` should include:

- precedence order (user instruction > project override > plugin defaults),
- YAML-style policy example,
- brief notes explaining omitted policy = default behavior.

`docs/infrastructure.md` should include:

- infrastructure provider/environment model (AWS/Azure/GCP/VPS/on-prem/etc.),
- runtime topology and core services,
- deployment model and critical operational constraints,
- source-of-truth references (IaC, scripts, console-managed resources if any).

`docs/architecture.md` should include:

- system architecture overview and boundaries,
- technology stack and major frameworks/libraries in use,
- core module/service interaction map,
- invariants and safe-change guidance.

`docs/integrations.md` should include:

- integration catalog (internal/external services),
- authentication/authorization model per integration,
- request/response or event contract references,
- dependency ownership, limits, and failure handling notes.

`docs/environments.md` should include:

- environment matrix (local/dev/staging/prod),
- configuration and secret source boundaries,
- deployment flow differences by environment,
- observability and access notes per environment.

`docs/glossary.md` should include:

- canonical domain terms and acronyms,
- disambiguation for overloaded words,
- links to source-of-truth docs where terms are applied.

`docs/runbooks/README.md` should include:

- runbook index table,
- ownership/escalation expectations,
- required runbook template sections.

---

## Verification

At the end, report:

- directories created,
- `.gitkeep` files created,
- files created,
- files skipped because they already existed.

If any required path could not be created, return a clear error with the exact path and reason.

## Next Recommended Commands

- `/pwf-doc-foundation all` to populate core project documentation baseline
- `/pwf-doc-runbook <service-or-operation>` to start documenting operations
- `/pwf-brainstorm` to start discovery for a new feature
- `/pwf-plan` to build an execution-ready plan
- `/pwf-work` for direct small implementation tasks
- `/pwf-work-plan` to execute an existing plan phase
