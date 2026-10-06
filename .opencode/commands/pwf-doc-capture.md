---
description: "Document a recently solved problem OR a new implementation pattern to accumulate team knowledge. Two modes: (1) /pwf-doc-capture [context] — document a bug/problem fix in docs/solutions/. (2) /pwf-doc-capture pattern [context] — document a reusable implementation pattern in docs/solutions/patterns/. Writes to docs/solutions/ with YAML frontmatter for learnings-researcher."
---

# Capture Reusable Learnings and Patterns

Use this command to explicitly register reusable learnings so future work can reuse them quickly.
Detailed playbook: `.opencode/assets/docs-playbook.md`.

## Modes

- `/pwf-doc-capture` — document the most recent fix from conversation (problem → solution)
- `/pwf-doc-capture [context]` — e.g. "N+1 in list", "trigger timeout"
- `/pwf-doc-capture pattern` — document a reusable implementation pattern (not a bug fix)
- `/pwf-doc-capture pattern [context]` — e.g. "role-based visibility", "new SQS Lambda pipeline stage"

---

## Mode 1: Problem/Solution (default)

Use when documenting a solved issue with root cause, fix, and prevention.

Run the playbook from `.opencode/assets/docs-playbook.md`:

1. Parallel analysis tracks
2. Pattern extraction check
3. Assemble and write solution doc
4. Optional focused reviewer validation
5. For reusable patterns, read and execute `.opencode/agents/docs/pattern-extractor.md` instructions explicitly.

## Mode 2: Pattern (`/pwf-doc-capture pattern`)

Use when the outcome is a reusable implementation pattern.

Run the pattern workflow from `.opencode/assets/docs-playbook.md` and write to:

- `docs/solutions/patterns/<category>/<name>.md`

---

## Preconditions

- Problem is **solved** and verified (Mode 1).
- Non-trivial (worth documenting for future lookup).

## Categories

Choose a concrete, searchable category in `docs/solutions/` (problem/solution) or
`docs/solutions/patterns/` (pattern mode). Keep names specific and stable.

## Success

Confirm: "Documentation complete. File: `docs/solutions/<category>/<filename>.md`" (and pattern file if applicable). Suggest: link related docs, run `/pwf-plan` or continue workflow.

## Next Recommended Commands

- `/pwf-doc update` to propagate learned patterns across stale docs
- `/pwf-plan` when the learning implies a broader architectural follow-up
- `/pwf-commit-changes` when documentation updates are complete
