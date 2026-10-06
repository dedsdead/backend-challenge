# Operational Overrides

Project-level policy overrides for all workflow commands run in this repository.

## Precedence order

1. **User instruction** — explicit direction in the current conversation always wins.
2. **Project override** — policies declared in this file apply to every workflow run.
3. **Plugin defaults** — built-in workflow/skill behavior applies when neither of the
   above says otherwise.

A policy omitted here is **not** disabled — it falls back to the plugin default.
Only explicit overrides in this file change default behavior.

## Policy format

Overrides are declared as YAML-style key/value entries under a stable heading, one
policy per entry:

```yaml
# docs/workflow/operational-overrides.md
docs:
  scope: project            # project docs live in ./docs (rule: AGENTS.md #docs-scope-boundary — file not yet present, scope user-confirmed as ./docs)
  destructive_edits: never   # never delete or overwrite non-empty files unless asked
verification:
  require_fresh_evidence: true  # re-run build/lint/tests before claiming completion
commits:
  auto_commit: false         # only commit when the user explicitly asks
```

## Active overrides

```yaml
docs:
  scope: project
  destructive_edits: never
  create_missing_only: true
commits:
  auto_commit: false
```

## Notes

- Adding a key here changes behavior for every subsequent workflow run in this repo.
- Removing a key reverts that policy to the plugin default.
- Overrides must stay consistent with `AGENTS.md`; if the two disagree, raise the
  conflict instead of silently choosing one.
- **Known gap (as of 2026-10-06):** `AGENTS.md` does not exist in this repository, so
  the `#docs-scope-boundary` rule cannot be read. Effective scope is the
  user-confirmed value `project` → `./docs`. When `AGENTS.md` is added, its rule
  supersedes the confirmation and this note must be removed.
