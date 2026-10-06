---
name: commit-changes
description: "Commit uncommitted changes across all workspace repos and tag commits with ticket numbers. Each repo gets its own subagent that analyzes files individually, groups them by ticket, and makes multiple focused commits. Use when the user pastes issue text (with TICKET-XXX) and wants to commit, or says 'commit with these tickets' / 'commit my changes'."
---

# Commit Changes Skill

## Trigger conditions

Use this skill when the user:

- Pastes one or more issues (with `# Title` and `Identifier: TICKET-XXX` lines) and wants to commit.
- Says "commit with these tickets", "commit my changes for TICKET-727", "commit everything and tag by ticket", or similar.
- Runs the **/pwf-commit-changes** slash command with pasted content.

## What to do

Follow the workflow in `commands/commit-changes.md` exactly.

### Summary of phases

1. **Parse** — extract `{ id: "TICKET-XXX", title: "..." }` for each ticket from the pasted text.
2. **Discover repos** — `git -C <path> status --short` for every workspace path; skip empty or non-git. Collect only the list of repos with changes (no diffs at orchestrator level).
3. **Spawn one subagent per repo (all in parallel)** — each subagent (generalPurpose, model: fast) reads `skills/commit-changes-repo-worker/SKILL.md`, fetches per-file diffs itself, classifies each file to the best ticket, groups files by ticket, and makes **multiple targeted commits** (one per group). Reports back a JSON result with a `commits` array.
4. **Summarize** — parse JSON results from all subagents, print a results table (one row per commit), show total commit count.

### Worker skill

Each per-repo subagent follows `skills/commit-changes-repo-worker/SKILL.md`.
The main agent passes these inputs to each worker:
- `REPO_PATH` — absolute path
- `REPO_NAME` — short name
- `TICKET_LIST` — formatted list of `TICKET-XXX: title`

The worker fetches its own per-file diffs — no diff text is passed from the orchestrator.

### Key difference from single-commit approach

The worker **never** runs `git add -A`. Instead, for each ticket group it runs:
```bash
git -C <REPO_PATH> add -- <file1> <file2> ...
git -C <REPO_PATH> commit -m "<ticket-specific message>"
```

This produces clean, reviewable git history with one commit per ticket per repo.

## Commit message rules (AGENTS.md (#commit-messages) — always enforced)

```
[TICKET-XXXX] <emoji> <type>(<scope>): <subject>
```

| Rule | Detail |
|------|--------|
| **Language** | English only |
| **Ticket prefix** | `[TICKET-XXXX]` when a ticket match exists; omit when NONE |
| **Emoji** | Always include — 🐛 fix, 🚀 feat, ♻️ refactor, 🎨 style, ⚡ perf, ✅ test, 📝 docs, 🔧 chore, 🔒 security, 🚧 wip |
| **Type** | One of: fix, feat, refactor, style, perf, test, docs, chore, security, wip |
| **Mood** | Imperative — "add", not "added" / "adds" |
| **Subject length** | ≤ 50 characters (not counting the `[TICKET-XXX]` prefix and emoji+type) |
| **Ticket position** | Prefix only — never inside the subject line itself |

**Examples:**

```
[TICKET-727] 🐛 fix(tasks): move back-to-table btn to right side
[TICKET-726] 🐛 fix(text-input): allow clicking inside widget
[TICKET-734] 🐛 fix(tasks): prevent stale WebSocket reconnect error
[TICKET-729] 🚀 feat(projects): demote lead adds them as contributor
🔧 chore(migrations): add project lead contributor column   ← no ticket when unmatched
```

## Constraints

- **No branches** — commit on the current branch of each repo; do not create or switch branches.
- **No push** — local commits only; remind user to push when ready.
- **No bulk staging** — always stage specific files per commit group, never `git add -A`.
- **Parallel processing** — all per-repo workers are processed by reading the worker skill once and applying it to each repo.
- **No main-agent git ops** — the main agent never runs `git add` or `git commit` directly; all git work is delegated to the per-repo worker logic.
- **Worker contract** — each worker execution returns: `{ repo, status, commits: [...], error }`.
