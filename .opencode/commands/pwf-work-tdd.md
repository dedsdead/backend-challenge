---
description: "Execute implementation using optional TDD flow (red-green-refactor). Use only when user explicitly requests tests-first behavior."
---

# Execute Work with TDD (Opt-In)

Use this command only when tests-first delivery is explicitly requested.
Apply `skills/using-psters-workflow/SKILL.md` at start.

## Input

<work_tdd_description> $ARGUMENTS </work_tdd_description>

If empty, ask: "What should I implement with TDD?"

## Workflow

1. Apply `skills/docs-baseline-loading/SKILL.md` and execute baseline loading before coding.
2. Run `/pwf-work` Step 1 research discipline (docs first, context first).
3. Apply `skills/test-driven-development/SKILL.md`.
4. For each small behavior slice:
   - write failing test (Red),
   - implement minimal fix (Green),
   - refactor safely (Refactor).
5. Keep verification evidence in each cycle.
6. Apply `skills/docs-maintenance-after-work/SKILL.md` before finishing.
7. Finish with `/pwf-review` and `/pwf-commit-changes` recommendations. Work commands update docs as part of the workflow; use `/pwf-doc` or `/pwf-doc-capture` for explicit scope-targeted documentation.

## Boundaries

- Do not force TDD on unrelated tasks.
- Keep test scope focused on requested behavior only.

## Verification Evidence Format

Use the shared evidence format from `AGENTS.md (#operational-guardrails)`.

Project-specific override is allowed via `docs/workflow/operational-overrides.md` (if present).

## Next Recommended Commands

- `/pwf-review` after TDD cycles are complete
- `/pwf-commit-changes` when review passes
