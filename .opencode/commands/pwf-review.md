---
description: "Multi-agent code review. Runs contextual review agents based on what was changed. No compound-engineering.local.md dependency."
---

# Step 4 — Review and Validate Changes

Use this command to run a structured multi-agent review after implementation, then fix findings and re-run until the change is ready.
Apply `skills/using-psters-workflow/SKILL.md` at start.

## Target

<review_target> $ARGUMENTS </review_target>

Determine: PR (number/URL), branch name, or current branch. Fetch diff and file list:
- PR: `gh pr view <number>` + `gh pr diff <number>`
- Branch: `git diff main...<branch> --name-only` + `git diff main...<branch>`

## Protected Artifacts

Never recommend deleting or ignoring `docs/plans/*.md` or `docs/solutions/*.md`. Discard any agent finding that suggests removing these.

## Run Review Agents

First inspect which repos/files were changed. Then execute all applicable review agents by reading and applying their instructions:

1. Read `.opencode/assets/review-agent-selection-mapping.md` to choose agents based on changed scope.
2. Always include the baseline reviewers from the mapping.
3. If reviewer feedback comments are provided as input, also execute `pr-comment-resolver` (`.opencode/agents/workflow/pr-comment-resolver.md`) to propose/implement fixes.
4. If major TypeScript/JS changes are present, include the `lint` reviewer agent (`.opencode/agents/workflow/lint.md`) in the review loop.
5. For each selected agent, read its agent file and execute the review instructions with the full diff content and changed file list.
6. You can read multiple agent files in parallel.

## Synthesize

Merge findings; remove duplicates; prioritize by severity (critical → warning → informational). Present:
1. **Summary** — what changed and scope
2. **Critical issues** — must fix before merge
3. **Recommendations** — should fix
4. **Informational** — optional improvements

Use `skills/requesting-code-review/code-reviewer.md` as the default output template for the final synthesized review.

## Next Recommended Commands

- `/pwf-work` or `/pwf-work-plan` to resolve critical findings
- `/pwf-commit-changes` once critical findings are resolved
- `/pwf-doc-capture` if review uncovered a reusable lesson/pattern
