---
name: finishing-a-development-branch
description: "Use when implementation is complete to close branch/worktree with a disciplined decision flow (merge, PR, keep, discard) plus cleanup."
---

# Finishing a Development Branch

Use this at the end of implementation to close work cleanly and avoid abandoned branches/worktrees.

## Step 1: Verify before finish

Run relevant verification commands first (build/lint/repro command as applicable). Do not proceed with failing verification.

## Step 2: Present exactly 4 options

1. Merge locally into base branch
2. Push and create PR
3. Keep branch/worktree for later
4. Discard branch/worktree

## Step 3: Execute chosen path safely

- For merge/PR: ensure base branch context is correct.
- For discard: require explicit confirmation.
- Never force push unless explicitly requested.

## Step 4: Worktree cleanup rules

- Merge/Discard: cleanup worktree.
- Keep/PR: keep worktree unless user asks to remove it.

## Expected output

- Selected option
- Commands executed
- Current branch/worktree status
- Any follow-up action required
