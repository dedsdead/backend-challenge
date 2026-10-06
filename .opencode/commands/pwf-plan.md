---
description: "Create a detailed, execution-ready implementation plan. Thorough research + review agents ensure each phase can be executed directly by /pwf-work-plan without additional planning. Saves to docs/plans/."
---

# Step 2 — Build an Execution Plan

**Note: The current year is 2026.**

Use this command to convert the feature context (or brainstorm) into a phased, execution-ready plan in `docs/plans/` that `/pwf-work-plan` can run directly.

When ambiguity materially impacts architecture/scope, run `/pwf-clarify` before finalizing the plan.
Apply `skills/using-psters-workflow/SKILL.md` at start.

---

## ⚠️ Agent Execution (REQUIRED)

**OpenCode Adaptation**: This workflow executes agents by reading their instruction files and applying them directly. OpenCode does not use the Task tool from Cursor.

For each agent, **read its agent file** and execute the instructions with the given input. You can read multiple agent files in parallel to optimize performance.

| Agent | File path |
|-------|-----------|
| repo-research-analyst | `.opencode/agents/research/repo-research-analyst.md` |
| learnings-researcher | `.opencode/agents/research/learnings-researcher.md` |
| spec-flow-analyzer | `.opencode/agents/workflow/spec-flow-analyzer.md` |
| migration-impact-planner | `.opencode/agents/research/migration-impact-planner.md` |
| architecture-strategist | `.opencode/agents/review/architecture-strategist.md` |
| security-sentinel | `.opencode/agents/review/security-sentinel.md` |
| performance-oracle | `.opencode/agents/review/performance-oracle.md` |
| best-practices-researcher | `.opencode/agents/research/best-practices-researcher.md` |
| framework-docs-researcher | `.opencode/agents/research/framework-docs-researcher.md` |
| plan-document-reviewer | `.opencode/agents/workflow/plan-document-reviewer.md` |

---

## 0. Input

<feature_description> $ARGUMENTS </feature_description>

If empty, ask: "What would you like to plan? Describe the feature, bug fix, or improvement."

**Brainstorm check:** Search `docs/brainstorms/` for a matching brainstorm. If found, read it fully — it contains architecture decisions, integration impact, and resolved questions that drive this plan. Also read any related existing plans in `docs/plans/`.

**Preset support (optional):** If input contains `preset:<name>` (e.g. `preset:nestjs-api`), load `.opencode/presets/presets.json` and adapt planning emphasis/review focus to that preset. If missing/invalid, fall back to `general`.
Use preset `qualityProfile` guidance:
- `strict`: maximize coverage and risk controls.
- `balanced`: normal rigor.
- `fast`: smallest safe plan for hotfix scope.

---

## 1. Research

### Round 1 — Always (execute all research agents):

Execute the following agents by reading and applying their instructions:

1. **repo-research-analyst** (`.opencode/agents/research/repo-research-analyst.md`)
   - Purpose: Maps file paths, services, DTOs, entities, rules, existing enums, current migration state for the affected area
   - Input: Feature description, affected modules/areas
   - Output: Concrete file paths, existing patterns, migration state

2. **learnings-researcher** (`.opencode/agents/research/learnings-researcher.md`)
   - Purpose: Surfaces relevant solutions from `docs/solutions/`
   - Input: Feature description, technical domain
   - Output: Applicable patterns, previous solutions, best practices

3. **spec-flow-analyzer** (`.opencode/agents/workflow/spec-flow-analyzer.md`)
   - Purpose: Finds missing flows, edge cases, error states; produces Given/When/Then acceptance criteria
   - Input: Feature requirements
   - Output: Acceptance criteria and tasks to add

**Execution**: Read all three agent files and execute their instructions with the provided context. You can read multiple files in parallel.

### Round 2 — Conditional (execute applicable agents):

Execute the following agents when applicable by reading and applying their instructions:

1. **migration-impact-planner** (`.opencode/agents/research/migration-impact-planner.md`)
   - Condition: Execute if entity changes detected (new columns, entities, indexes, FK constraints, enum changes)
   - Input: Entity changes, current schema state
   - Output: Migration strategy, risks, atomic chain requirements

2. **best-practices-researcher** (`.opencode/agents/research/best-practices-researcher.md`)
   - Condition: Execute if the feature involves security, payments, or new third-party integrations
   - Input: Feature scope, integration requirements
   - Output: Security patterns, integration best practices

3. **framework-docs-researcher** (`.opencode/agents/research/framework-docs-researcher.md`)
   - Condition: Execute if the feature requires unfamiliar framework patterns
   - Input: Framework/library requirements
   - Output: Framework-specific patterns and conventions

4. **git-history-analyzer** (`.opencode/agents/research/git-history-analyzer.md`)
   - Condition: Execute for legacy/refactor work where historical intent matters
   - Input: Files to analyze, refactor scope
   - Output: Historical context, previous decisions

**Execution**: Read applicable agent files and execute their instructions. You can read multiple files in parallel.

### Round 3 — Review (execute applicable agents):

Execute the following review agents by reading and applying their instructions:

1. **architecture-strategist** (`.opencode/agents/review/architecture-strategist.md`) — **ALWAYS**
   - Purpose: Structural approach, module boundaries, dependency direction
   - Input: Proposed solution, existing architecture
   - Output: Architecture feedback, structural recommendations

2. **security-sentinel** (`.opencode/agents/review/security-sentinel.md`)
   - Condition: Only if auth, secrets, permissions, encryption, or file upload involved
   - Input: Security-sensitive components
   - Output: Security risks, mitigation strategies

3. **performance-oracle** (`.opencode/agents/review/performance-oracle.md`)
   - Condition: Only if DB-heavy (new queries, pagination, indexes, N+1 risks)
   - Input: Database operations, query patterns
   - Output: Performance risks, optimization recommendations

**Execution**: Read applicable agent files and execute their instructions. You can read multiple files in parallel.

Consolidate all findings: exact file paths, method names, learnings, conventions, acceptance criteria, architecture feedback.

---

## 2. Scope & Concretization

### 2a. When copying or mirroring existing features:
- Open the existing feature/component. Derive: files and sizes, sections/sub-components, flows to strip vs keep.
- In the plan: enumerate "copy these files, strip A/B/C, keep D" or document copy vs reuse decision.
- Split large copies into multiple tasks.

### 2b. When the feature has many requirements (5+ items):
- Parse and group requirements by layer (backend/frontend) or capability.
- Add a **Scope / Work Breakdown** section listing each group with its requirements.
- Assign groups to phases. Cap phase size — no phase should have 10+ unrelated items.

### 2c. When inline editing is involved:
- List editable fields/sections from the codebase or backend DTOs.
- Document the UX pattern (edit toggle per section, global edit mode, or click-to-edit).
- Reference in implementation tasks.

### 2d. When a different API serves the same UI:
- Document response shape of the new API and mapping to the shape the UI expects.
- Include a mapping task in implementation.

If none of the above apply, skip this step.

---

## 3. Phase Assessment

Use **phases** when: multi-layer (DB + API + frontend), 4+ files, clear dependency chain. Otherwise use **flat tasks** (a single numbered list under `## Implementation`).

If phased: phases are dependency-ordered. Each phase must have a **clear theme** and a **bounded** set of tasks. Apply splitting and grouping rules from Step 2.

---

## 4. Write Plan

Write to `docs/plans/<TIMESTAMP>-<name>-plan.md` (`TIMESTAMP` = current time in `YYYYMMDDHHmmss`).

### YAML frontmatter:

```yaml
---
title: "<Plan Title>"
type: enhancement | bug | refactor
status: active
date: YYYY-MM-DD
phased: true | false
---
```

### Required sections:

1. **Overview** — Problem/Motivation, what we're building, who it's for
2. **Scope / Work Breakdown** — (if applicable from 2b) Groups of requirements mapped to phases
3. **Proposed Solution** — Architecture, data model, key design decisions. Reference brainstorm decisions if one exists.
4. **Technical Considerations** — Reference project rules (ORM discipline, error capture, English text), `docs/solutions/` patterns, security notes, migration safety
5. **Acceptance Criteria** — From spec-flow-analyzer: Given/When/Then covering happy path, all roles, and error states
6. **Implementation Plan** — Phases or flat tasks (see format below)
7. **Master Checklist** — Every task as a checkbox
8. **Clarifications** — Link to clarifications artifact (`docs/plans/<plan-slug>.clarifications.md`) when relevant

### Ambiguity handling

When any critical requirement is unclear, add:

`[NEEDS CLARIFICATION: specific question]`

Do not guess on scope/auth/security boundaries when ambiguity changes implementation.

### Phase format (phased plans):

The `## Implementation Plan` section **must** open with a summary table, then each phase:

```
## Implementation Plan

| Phase | Name | Depends On | Status |
|-------|------|------------|--------|
| 1 | [Phase 1 name] | None | ⬜ Pending |
| 2 | [Phase 2 name] | Phase 1 | ⬜ Pending |

---

### Phase N: [Name]

**Status**: ⬜ Pending
**Objective**: [One sentence — what this phase achieves]
**Dependencies**: [Phase N-1 or None]

**Tasks** (strict format):

- [ ] T001 [US1] Create DTO in `backend/src/modules/projects/dto/create-project.dto.ts`
  - Add `name: string`, `status: ProjectStatus`, `ownerId: string`
- [ ] T002 [P] [US1] Add mapper in `backend/src/modules/projects/projects.mapper.ts`
  - Add `toResponseDto(entity: ProjectEntity): ProjectResponseDto`
- [ ] T003 [US1] Extend service in `backend/src/modules/projects/projects.service.ts`
  - Add `createProject(dto: CreateProjectDto, userId: string): Promise<ProjectEntity>`

**After completing this phase**:
1. TypeScript Validation — Run `npm run validate` (or `tsc --noEmit` if no validate script) in affected repos; fix all type/lint errors.
2. Build — Only run `npm run build` when explicitly requested or preparing for deployment.
2. Update this plan — mark Phase N as `✅ Completed` in the table.
```

### Flat tasks format (non-phased):

```
## Implementation

- [ ] T001 Create/update `path/to/file.ts`
  - Specific change: method name, field name, decorator, class
- [ ] T002 [P] Create/update `path/to/other-file.ts`
  - Specific change details

**After implementation**: Run `npm run validate` (or `tsc --noEmit`), fix all type/lint errors. Build only when explicit.
```

### Master Checklist (always required for phased plans):

```
## ✅ Master Checklist

### Phase1: [Name]
- [ ] T001 [US1] Task short label
- [ ] T002 [P] [US1] Task short label
- [ ] TypeScript validation passes (build only when explicit)

### Phase2: [Name]
- [ ] ...
```

---

## 5. Task Quality Rules

Every task MUST have:
- Checklist line format: `- [ ] T### [P?] [USx?] Description with \`path/to/file\``
- Exact file path in every task line
- **Concrete sub-bullets** with: method signatures, field names with types, DTO property names, import paths
- Enough detail that an AI can execute it without guessing

Every task MUST NOT have:
- Vague descriptions like "implement the feature" or "add the logic"
- Test-related steps (unless project rules require tests)
- Multiple unrelated concerns in one task
- Missing IDs, missing file paths, or missing `[USx]` labels for story-phase tasks

**Migration tasks are special:** When a phase includes entity changes that require a migration, the migration task MUST explicitly state: "Generate migration → drift-check → run locally IMMEDIATELY (atomic chain — see ORM migration discipline skill)." This prevents the AI from deferring the local run, which causes schema drift in subsequent migrations.

**Self-validation:** After writing, review every task. Ask: "Could an AI execute this task by reading only this plan and the referenced files?" If no, rewrite it inline before presenting.

---

## 6. Plan Review Loop (MANDATORY)

After writing the plan, run a formal review loop using `plan-document-reviewer`:

1. Read and execute `.opencode/agents/workflow/plan-document-reviewer.md` with the generated plan path and relevant context summary.
2. Apply only execution-impacting fixes (`CRITICAL`/`HIGH`) immediately.
3. Re-run the reviewer agent.
4. Stop when approved or after a maximum of 3 iterations.

If still not approved after 3 iterations, present open blockers explicitly and ask user for direction before execution.

Note that `.opencode/plugins/docs-memory-guard.js` runs automatically during the following `/pwf-work*` phase and will flag, at session end, whether docs were updated alongside code.

---

## 7. Post-Generation

Present: plan summary, phase count, task count. Offer:
- Run `/pwf-clarify [plan-path]` if ambiguities remain
- Run `/pwf-checklist [plan-path]` for requirement quality gates
- Run `/pwf-analyze [plan-path]` for cross-artifact consistency
- Start `/pwf-work-plan [path]` to execute the first phase
- Review a specific section
- Continue refining

---

## Conventions

- Follow canonical policy in `AGENTS.md (#operational-guardrails)`
- Follow commit policy in `AGENTS.md (#commit-messages)`
- Use optional project overrides in `docs/workflow/operational-overrides.md` when present.

## Next Recommended Commands

- `/pwf-clarify <new-plan-path>` when open ambiguities exist
- `/pwf-checklist <new-plan-path>` before execution
- `/pwf-analyze <new-plan-path>` before execution
- `/pwf-work-plan <new-plan-path> Phase1` to start implementation
