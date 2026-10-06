---
description: "Refresh and curate docs/solutions/ entries using an interactive lifecycle: Keep, Update, Replace, or Archive. User approval is required before any write action."
---

# Refresh Documentation Knowledge (Interactive)

Use this command to prevent `docs/solutions/` from drifting or becoming stale.
Detailed lifecycle playbook: `.opencode/assets/docs-playbook.md`.

## Scope

<doc_refresh_scope> $ARGUMENTS </doc_refresh_scope>

If empty, scan all `docs/solutions/`.
If provided, scope to matching category/path.

## Lifecycle actions

For each target doc, recommend one action:

- `Keep` — current and still useful
- `Update` — same doc needs content refresh
- `Replace` — superseded by a new canonical doc
- `Archive` — no longer useful for current architecture

## Workflow (user-controlled)

1. Discover candidate docs in scope.
2. Compare each doc with current code/docs patterns.
3. Propose one action with short rationale and confidence.
4. Ask user approval **one doc at a time** before any mutation.
5. Apply approved action and append a concise `Refresh Notes` section.

## Rules

- No autonomous mode.
- No bulk destructive edits.
- Never delete protected workflow artifacts outside `docs/solutions/`.
- If confidence is low, default to `Keep` and ask follow-up question.

## Output

Report:
- docs reviewed
- actions approved/applied
- docs skipped/deferred
- follow-up suggestions

## Next Recommended Commands

- `/pwf-doc-capture` to capture a newly solved issue/pattern
- `/pwf-doc update` to propagate cross-doc consistency after refresh
