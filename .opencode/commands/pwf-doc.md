---
description: "Documentation command. Modes: (1) /pwf-doc infrastructure <component> — infrastructure/service doc, (2) /pwf-doc module <module> — backend module doc, (3) /pwf-doc feature <feature> — frontend/UI feature doc, (4) /pwf-doc architecture — system architecture overview, (5) /pwf-doc update — scan all docs for staleness and contradictions, (6) /pwf-doc adr '<decision>' — create an Architecture Decision Record, (7) /pwf-doc custom '<target and pattern>' — generate any project documentation from a user-described scope and format, (8) /pwf-doc infrastructure — project infrastructure source of truth."
---

# Force Technical Documentation by Scope

**Note: The current year is 2026.**

Use this command when you want explicit technical documentation output for a specific scope (module, feature, architecture, ADR, or global update). This is the general command to generate or update any documentation by described scope.

**Work commands already update docs.** `/pwf-work`, `/pwf-work-plan`, `/pwf-work-light`, and `/pwf-work-tdd` update docs as part of their workflow. Use `/pwf-doc` for explicit, scope-targeted documentation beyond that flow.

**Anti-drift guidance:** Before creating new docs, check if a related doc already exists. Prefer updating or syncing the existing doc instead of creating duplicates. This avoids drift and keeps documentation authoritative.

The living documentation lives in:
- `docs/infrastructure/` — Services, Lambdas, containers, infrastructure components
- `docs/modules/` — Backend modules (NestJS, Next.js API routes, etc.)
- `docs/features/` — Frontend features and UI components
- `docs/decisions/` — Architecture Decision Records (ADRs)
- `docs/architecture.md` — System-wide architecture overview

## Input

<doc_target> $ARGUMENTS </pwf-doc_target>

If empty, show:
```
Usage:
  /pwf-doc infrastructure <component>  Document infrastructure/service (e.g. /pwf-doc infrastructure api-gateway)
  /pwf-doc module <module-name>        Document a backend module     (e.g. /pwf-doc module projects)
  /pwf-doc feature <feature-name>      Document a frontend feature   (e.g. /pwf-doc feature dashboard)
  /pwf-doc architecture                Generate/update docs/architecture.md
  /pwf-doc update                      Scan all docs for staleness and contradictions
  /pwf-doc adr "<decision>"            Create an Architecture Decision Record
  /pwf-doc custom "<target-and-pattern>"  Generate/update any doc from user-described scope
  /pwf-doc infrastructure              Generate/update docs/infrastructure.md
```

---

## Agent Execution

**OpenCode Adaptation**: Execute docs agents by reading their instruction files and applying them directly.

## Mode 1: `/pwf-doc infrastructure <component-name>`

### Step 1: Verify component exists
Check that the infrastructure component exists in the workspace. If not, list available components and ask user to pick.

### Step 2: Execute `infrastructure-doc-writer`
Read and execute `.opencode/agents/docs/infrastructure-doc-writer.md` instructions, passing the component path and any existing `docs/infrastructure/<component-name>.md`.

### Step 3: Write the doc
- Ensure `docs/infrastructure/` directory exists
- Write returned text to `docs/infrastructure/<component-name>.md`
- Confirm: "Infrastructure documentation written: `docs/infrastructure/<component-name>.md`"

---

## Mode 2: `/pwf-doc infrastructure` (all components)

### Step 1: Discover all infrastructure components
Discover infrastructure components in the workspace (services, Lambdas, containers, or project-specific patterns).

### Step 2: Execute `infrastructure-doc-writer` for all components
Read and execute `.opencode/agents/docs/infrastructure-doc-writer.md` instructions for each component. You can process multiple components by reading the agent file once and applying it to each.

### Step 3: Write all docs
For each returned doc, write to `docs/infrastructure/<component-name>.md`. Confirm each.

### Step 4: Update `docs/infrastructure/README.md`
Update the index table with all documented infrastructure components and links to individual docs.

---

## Mode 3: `/pwf-doc module <module-name>`

### Step 1: Verify module exists
Check that the module exists in the project (e.g., `src/modules/<module-name>/` or equivalent). If not, list available modules and ask user to pick.

### Step 2: Execute module doc writer
Read and execute the appropriate module documentation agent (e.g., `backend-module-doc-writer` for NestJS), passing:
- Module path: project-specific path
- Existing doc if present: `docs/modules/<module-name>.md`

Wait for the agent to return text.

### Step 3: Write the doc
- Ensure `docs/modules/` directory exists
- Write returned text to `docs/modules/<module-name>.md`
- Update `docs/modules/README.md` — add or update the entry for this module in the catalog table
- Confirm: "Module documentation written: `docs/modules/<module-name>.md`"

---

## Mode 4: `/pwf-doc feature <feature-name>`

### Step 1: Verify feature exists
Check that the feature exists in the project (e.g., `src/features/<feature-name>/` or equivalent). If not, list available features and ask user to pick.

### Step 2: Execute feature doc writer
Read and execute the appropriate feature documentation agent (e.g., `frontend-feature-doc-writer` for Angular), passing:
- Feature path: project-specific path
- Existing doc if present: `docs/features/<feature-name>.md`

Wait for the agent to return text.

### Step 3: Write the doc
- Ensure `docs/features/` directory exists
- Write returned text to `docs/features/<feature-name>.md`
- Update `docs/features/README.md` — add or update the entry for this feature in the catalog table
- Confirm: "Feature documentation written: `docs/features/<feature-name>.md`"

---

## Mode 5: `/pwf-doc architecture`

### Step 1: Gather context (parallel reads)
Read/update context from:
- `docs/infrastructure/` (if exists)
- `docs/modules/` (if exists)
- `docs/features/` (if exists)
- `docs/solutions/patterns/critical-patterns.md` (if exists)
- recent `docs/plans/`, `docs/brainstorms/`, and ADRs in `docs/decisions/`

### Step 2: Execute dedicated docs agent
Read and execute `.opencode/agents/docs/architecture-doc-writer.md` instructions and pass gathered context plus existing `docs/architecture.md` (if present).

### Step 3: Write the doc
Write returned content to `docs/architecture.md`. Confirm.

---

## Mode 6: `/pwf-doc update`

Scan ALL living docs for staleness and contradictions without requiring a specific diff.

### Step 1: Discover all living docs
List all `.md` files in:
- `docs/infrastructure/`
- `docs/modules/`
- `docs/features/`
- `docs/solutions/`
- `docs/decisions/`
- `docs/architecture.md`

### Step 2: Read the codebase state
For each doc, extract the file paths, class names, and method names it references. Check each against the actual codebase to find stale references.

**Efficient approach**: Read all `docs/solutions/patterns/` and `docs/infrastructure/` first (highest churn), then module and feature docs.

### Step 3: Execute `doc-shepherd` for full scan
Read and execute `.opencode/agents/workflow/doc-shepherd.md` instructions. Since there's no specific diff to analyze, pass:
- `diff`: "Full documentation audit — no specific diff"
- `changed_files`: all files in the codebase (summary by directory)
- `work_summary`: "Full documentation freshness and consistency audit"

The agent should focus on contradiction detection across all docs.

### Step 4: Review report and inform user
Review the shepherd report (the agent writes updates directly to disk). Report to user: what was updated, what contradictions were found (and ask for resolution if any).

---

## Mode 7: `/pwf-doc adr "<decision>"`

Create an Architecture Decision Record documenting a significant architectural choice.

### Step 1: Parse the decision
The argument is a short description of the decision (e.g., `"use Mailgun over SES for transactional email"`).

### Step 2: Gather context
Collect decision context from user input and relevant artifacts:
- latest related brainstorm/plan docs,
- relevant architecture/infrastructure docs,
- any constraints from critical patterns.

### Step 3: Execute dedicated ADR agent
Read and execute `.opencode/agents/docs/adr-writer.md` instructions and provide:
- decision summary,
- gathered context,
- full canonical template content from `.opencode/assets/adr-template.md`.

Generate filename: `docs/decisions/YYYY-MM-DD-<slugified-decision>.md`
Write returned ADR content to that file.

### Step 4: Update `docs/decisions/README.md`
Add an entry for the new ADR in the catalog table.

Confirm: "ADR created: `docs/decisions/<filename>.md`"

---

## Mode 8: `/pwf-doc custom "<target-and-pattern>"`

Use this when the user wants to generate/update any documentation type that does not fit a strict preset mode.

Examples:
- `/pwf-doc custom "document the existing billing flow in docs/modules/billing.md with source-of-truth files and invariants"`
- `/pwf-doc custom "create docs/features/dashboard.md using the same structure as docs/features/projects.md"`

### Step 1: Parse target and expected format
Extract:
- target doc path (or infer one under `docs/`)
- intent (create vs update)
- required structure/pattern from the user description

If target path is missing, propose one and ask user confirmation before writing.

### Step 2: Anti-drift preflight (MANDATORY)
Before creating new files:
- search for existing docs covering the same scope
- if one exists, update that file instead of creating a duplicate
- if multiple similar docs exist, ask user to choose the canonical target first, then optionally run `/pwf-doc update` for a global consistency pass

### Step 3: Gather source-of-truth context
Read the relevant code and related docs needed to produce accurate content:
- exact file paths and symbols
- current behavior vs planned behavior
- invariants, gotchas, and safe change checklist

### Step 4: Write or update the target doc
Produce operational documentation that is specific, concrete, and reusable.
Avoid generic summaries.

### Step 5: Cross-doc sync check
Run a consistency pass against related docs and call out any conflicts.
If conflicts are found, propose updates (or run `/pwf-doc-refresh` for interactive lifecycle decisions).

Confirm: "Custom documentation updated: `<target-path>`"

---

## Mode 9: `/pwf-doc infrastructure`

Generate or refresh `docs/infrastructure.md` as the project's infrastructure source of truth.

### Step 1: Gather context
Read/update context from:
- `docs/architecture.md`, `docs/integrations.md`, `docs/environments.md`,
- deployment scripts and infra-related references in the repository.

### Step 2: Execute dedicated infra docs agent
Read and execute `.opencode/agents/docs/infrastructure-doc-writer.md` instructions and pass gathered context plus existing `docs/infrastructure.md` (if present).

### Step 3: Write the doc
Write returned content to `docs/infrastructure.md`. Confirm.

---

## Triggering from `/pwf-work` and `/pwf-work-plan`

When invoked automatically from Phase 5 of `/pwf-work` or `/pwf-work-plan`, the mode and target are passed as arguments. The flow is the same as above.

## Next Recommended Commands

- `/pwf-doc-foundation all` to bootstrap or refresh the core project docs set
- `/pwf-doc-runbook <service-or-operation>` to add incident-ready operational procedures
- `/pwf-analyze <related-plan-path>` after major doc updates affecting execution decisions
- `/pwf-work-plan <plan-path> Phase N` to continue implementation with updated docs
- `/pwf-review` if documentation changes reflected major code-level decisions
