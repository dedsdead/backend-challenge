---
name: commit-changes-repo-worker
description: "Per-repo commit worker. Analyzes ALL changed files independently, groups them by ticket, and makes MULTIPLE focused commits — one per logical group. Spawned in parallel by /pwf-commit-changes (one instance per repo). Never create branches or push."
---

# Commit Changes Repo Worker

A focused, self-contained worker that handles **one repository** end-to-end:
inspect files → classify each file by ticket → group → make multiple targeted commits → report.

Spawned as a `generalPurpose` subagent (model: fast) from the `/pwf-commit-changes` command.
All instances run **in parallel** (one per repo).

---

## Inputs (provided in the parent prompt)

| Variable | Description |
|---|---|
| `REPO_PATH` | Absolute path to the git repository |
| `REPO_NAME` | Short repo name (e.g. `frontend`, `backend`) |
| `TICKET_LIST` | Newline-separated list of `TICKET-XXX: title` entries |

---

## Step 1 — Discover Changed Files

Run:

```bash
git -C <REPO_PATH> status --short
```

Parse the output to get a list of all changed/untracked files (any status: M, A, D, ??, R, etc.).

If the list is empty → skip to Step 5 (nothing_to_commit).

---

## Step 2 — Analyze Each File Independently

For every file identified in Step 1, fetch its individual diff:

```bash
# For tracked/modified/staged files:
git -C <REPO_PATH> diff HEAD -- "<file>"

# If the above returns nothing (e.g. newly staged or untracked):
git -C <REPO_PATH> diff --cached -- "<file>"
```

For each file, determine:
- What it does (based on file path + diff content)
- Which ticket from `TICKET_LIST` it most likely relates to, or `NONE`

Matching heuristics:
- File name/path aligns with the ticket's feature area (e.g. `tasks/` → ticket about tasks)
- Diff content (added/removed lines) matches the ticket description
- If a file clearly belongs to multiple tickets, assign it to the one with the highest coverage
- Config, tooling, migration, and infra files with no clear ticket → assign `NONE`

Build a map: `file → TICKET-XXX (or NONE)`

---

## Step 3 — Group Files by Ticket

Group all files by their assigned ticket:

```
Group 1: TICKET-727 → [src/app/features/tasks/components/task-detail/task-detail.component.html]
Group 2: TICKET-726 → [src/app/shared/components/text-input/text-input.component.scss, ...]
Group 3: NONE    → [src/database/migrations/1234567-SomeMigration.ts]
```

Rules:
- Each ticket gets its own commit group.
- `NONE` files that are clearly related to each other (e.g. multiple migration files for the same feature) can be grouped into a single `NONE` commit.
- `NONE` files from completely unrelated areas should get separate commits (e.g. a backend migration + a frontend config change → two separate NONE commits).
- If only one group exists (all files map to the same ticket, or all are NONE), that's fine — just one commit.

---

## Step 4 — Make One Commit Per Group

For each group, in order (ticket groups first, NONE groups last):

### 4a — Build the commit message

Format: `[TICKET-XXXX] <emoji> <type>(<scope>): <subject>`

Commit type + emoji reference:

| Emoji | Type | When |
|---|---|---|
| 🚀 | feat | new user-visible feature |
| 🐛 | fix | bug fix |
| ♻️ | refactor | code restructuring, no behaviour change |
| 🎨 | style | SCSS/CSS/formatting only |
| ⚡ | perf | performance improvement |
| ✅ | test | tests only |
| 📝 | docs | documentation |
| 🔧 | chore | maintenance, config, tooling, dependencies |
| 🔒 | security | security fix |
| 🚧 | wip | incomplete / in-progress work |

Rules:
- `[TICKET-XXXX]` prefix only when the group has a matched ticket; omit for `NONE`.
- `<scope>` = the main module/feature affected (e.g. `tasks`, `projects`, `migrations`).
- `<subject>` ≤ 50 characters, **English**, **imperative mood** ("fix", not "fixed"/"fixes").
- Subject must be descriptive of what this group actually changes — not generic.

### 4b — Stage only the files in this group

```bash
git -C <REPO_PATH> add -- <file1> <file2> ...
```

For deleted files and renamed files, `git add` handles them correctly with `--`.

### 4c — Commit

```bash
git -C <REPO_PATH> commit -m "$(cat <<'EOF'
<commit_message>
EOF
)"
```

Repeat Steps 4a–4c for every group before moving to the next.

---

## Step 5 — Report

Reply with **exactly** this JSON and nothing else:

```json
{
  "repo": "<REPO_NAME>",
  "status": "committed | failed | nothing_to_commit",
  "commits": [
    {
      "ticket": "TICKET-XXX or NONE",
      "message": "[TICKET-727] 🐛 fix(tasks): move back-to-table button to right side",
      "files": ["path/to/file1.ts", "path/to/file2.html"],
      "result": "ok | failed",
      "error": null
    },
    {
      "ticket": "TICKET-726",
      "message": "[TICKET-726] 🐛 fix(text-input): allow clicking inside widget",
      "files": ["path/to/text-input.component.scss"],
      "result": "ok | failed",
      "error": null
    }
  ],
  "error": "<top-level error or null>"
}
```

- `committed` — at least one commit succeeded.
- `nothing_to_commit` — no changed files found in Step 1.
- `failed` — all commit attempts failed; include `error`.

---

## Constraints

- **No branches** — commit on the current branch only.
- **No push** — local commits only; do not run `git push`.
- **No interactive commands** — do not run `git rebase -i`, `git add -p`, etc.
- **No bulk staging** — never run `git add -A`; always stage specific files per commit group.
- **Do not abort on pre-commit hook failure** — report `failed` on that group's `result`, continue with remaining groups.
