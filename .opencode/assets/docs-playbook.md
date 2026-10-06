# Docs Playbook

This playbook contains detailed execution for `/pwf-doc-capture` and `/pwf-doc-refresh`.

## `/pwf-doc-capture` modes

### Mode A - Problem/Solution

Use when documenting a solved issue with reusable operational value.

1. Run parallel analysis tracks:
   - context analyzer
   - solution extractor
   - related docs finder
   - prevention strategist
   - category classifier
2. Run `pattern-extractor` to detect reusable pattern.
3. Write:
   - `docs/solutions/<category>/<filename>.md`
   - optional pattern output under `docs/solutions/patterns/<category>/<filename>.md`
4. For non-trivial topics, run targeted validation reviewer:
   - performance -> `performance-oracle`
   - security -> `security-sentinel`
   - database -> `data-integrity-guardian`
   - code-heavy -> `kieran-typescript-reviewer`

### Mode B - Pattern

Use when the outcome is a reusable implementation pattern.

1. Run `pattern-extractor` with full context.
2. If `NO_PATTERN_FOUND`, stop and report.
3. Else write to `docs/solutions/patterns/<category>/<name>.md`.

## `/pwf-doc-refresh` lifecycle

Goal: keep `docs/solutions/` healthy and current.

Lifecycle options:

- `Keep`: still current and useful
- `Update`: same doc, content refresh
- `Replace`: superseded by a new canonical doc
- `Archive`: no longer useful for current architecture

Refresh workflow:

1. Discover target docs in `docs/solutions/` (or a scoped category).
2. For each doc, run a focused consistency check against current code and patterns.
3. Propose exactly one action (Keep/Update/Replace/Archive) with rationale.
4. Ask the user to approve action before mutating docs.
5. Apply approved action and record concise `Refresh Notes` section.

## Interaction style

- One question at a time.
- Prefer multiple choice options.
- Lead with recommended option + short reason.
- No autonomous mode for lifecycle actions.
