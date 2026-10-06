---
description: "Commit uncommitted changes across all workspace repos, tagging commits with ticket numbers from pasted issue text. Processes one worker per repo in parallel — each analyzes every changed file, groups them by ticket, and makes multiple focused commits independently."
---

# Step 5 — Create Structured Commits

Use this command to produce high-quality, ticket-aware commits after review, including multi-repo parallel commit organization when needed.

Each repo gets its own subagent that:
1. Inspects every changed file individually
2. Groups files by which ticket they relate to
3. Makes **multiple focused commits** — one per ticket group (plus separate commits for unrelated changes)

All repos run **in parallel**.

## Input

<commit_changes_input> $ARGUMENTS </commit_changes_input>

If empty, ask:
> "Paste the issue(s) or list the ticket number(s) (e.g. TICKET-727, TICKET-726), then I'll commit all uncommitted changes with organized, per-ticket commits."

---

## Phase 1 — Parse Tickets

Extract every ticket identifier and its short title from the pasted text:

- Look for `Identifier: TICKET-XXX` lines; the title is the `# Heading` above it (or after the last `------` separator).
- Build a list: `[{ id: "TICKET-727", title: "Move the BACK TO TABLE button to the right side" }, ...]`
- If no ticket is found, subagents will still commit with descriptive subjects but no `[TICKET-XXX]` prefix.

---

## Phase 2 — Discover Repos With Changes

For each **workspace path** (all paths from context — project roots, monorepo packages, etc.):

1. Run: `git -C <path> status --short`
2. Skip if not a git repo (exit code ≠ 0) or output is empty.
3. Record the repo path and name for repos that have uncommitted changes.

> **Note:** Do NOT collect diffs here. Each subagent will fetch its own per-file diffs in Step 2 of its workflow, allowing precise file-level ticket classification.

Build a list: `[{ path, name }]` of repos with uncommitted changes.

---

## Phase 3 — Process One Worker Per Repo (All in Parallel)

**Skill reference:** Read `skills/commit-changes-repo-worker/SKILL.md` once before processing repos to understand the multi-commit worker contract.

**OpenCode Adaptation**: For each repo with uncommitted changes, read and execute the worker skill instructions directly. You can process multiple repos by reading the skill file once and applying it to each repo.

Use this prompt template per repo:

---

```
You are a focused git commit worker for a single repository.
Read the skill at skills/commit-changes-repo-worker/SKILL.md for full instructions.

## Your inputs

REPO_PATH: {REPO_PATH}
REPO_NAME: {REPO_NAME}

## Ticket list

{TICKET_LIST}
(e.g.
- TICKET-727: Move the BACK TO TABLE button to the right side
- TICKET-726: Text input widget doesn't allow user to click inside
- TICKET-734: This error pops randomly after being dormant
- TICKET-732: Error when viewing TASK DETAILS
- TICKET-729: When I change the LEAD to a HO, they should be added as CONTRIBUTOR
)

## Instructions

Follow the commit-changes-repo-worker skill exactly:
1. Discover all changed files with `git -C {REPO_PATH} status --short`
2. Fetch per-file diffs and classify each file to the most relevant ticket (or NONE)
3. Group files by ticket
4. Make one focused commit per group (stage specific files only — never git add -A)
5. Return the JSON report with the `commits` array

Constraints: no branches, no push, no interactive git commands, no bulk staging.
```

---

Collect all JSON responses when subagents finish.

---

## Phase 4 — Summarize

Parse each subagent's JSON response. For each repo, print one row per commit:

| Repo | Ticket | Commit message | Files | Result |
|------|--------|----------------|-------|--------|
| frontend | TICKET-727 | `[TICKET-727] 🐛 fix(tasks): move back-to-table btn to right` | 2 files | ✅ |
| frontend | TICKET-726 | `[TICKET-726] 🐛 fix(text-input): allow click inside widget` | 1 file | ✅ |
| backend  | TICKET-729 | `[TICKET-729] 🚀 feat(projects): add lead as contributor on demotion` | 3 files | ✅ |
| backend  | NONE    | `🔧 chore(migrations): add project lead contributor migration` | 1 file | ✅ |

Then show a quick summary line:
> "X repos committed, Y commits total. All commits are local only — push each repo when ready."

If any commit **failed**, show the error and suggest: "Fix the issue and re-run `/pwf-commit-changes` for that repo."

---

## Commit Rules (AGENTS.md (#commit-messages) — always enforced)

- **Format**: `[TICKET-XXXX] <emoji> <type>(<scope>): <subject>`
- **English only** — subject and all commit text in English.
- **Imperative mood** — "add", "fix", "remove" (not "added"/"adds").
- **Subject ≤ 50 chars** (not counting `[TICKET-XXXX]` prefix and emoji/type).
- **Emoji required** — always pick from the type reference table.
- **Ticket as prefix only** — never inside the subject line.
- **No branches, no push** — targeted `git add <files>` + `git commit` on current branch only.
- **No bulk staging** — never `git add -A`; stage only the files belonging to each commit group.

---

## Architecture Note

Each repo subagent (generalPurpose, model: fast) handles the full lifecycle for its repo:
**file discovery → per-file diff → ticket classification → grouping → multiple targeted commits → JSON report.**

All subagents run in parallel. The main agent only orchestrates phases 1–2 and 4.
This produces organized, reviewable git history — one commit per ticket per repo.

## Next Recommended Commands

- `/pwf-review` if commits should be preceded by a final risk check
- `/pwf-aws-lambda-deploy` if Lambda code was committed and is ready to deploy
