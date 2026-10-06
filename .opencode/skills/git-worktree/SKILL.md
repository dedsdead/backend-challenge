---
name: git-worktree
description: "Manages Git worktrees for isolated parallel development. Use when creating separate working directories for branches without switching the main repo."
---

# Git Worktree

Create and use Git worktrees so multiple branches can be worked on in separate directories. Useful for parallel development, isolated agent tasks, or testing changes without disrupting the main working tree.

## Commands (run from repo root)

```bash
# List active worktrees
git worktree list

# Create worktree for new branch
git worktree add ../project-feat-x feature-branch

# Create worktree for existing branch
git worktree add ../project-fix origin/fix-branch

# Remove worktree (after switching away)
git worktree remove ../project-feat-x

# Prune stale worktree metadata
git worktree prune
```

## OpenCode integration

### Spawning agents in worktrees

Use the `task` tool to run agents in an isolated worktree:

```
1. Create worktree: bash → git worktree add ../isolated feature-branch
2. Spawn agent: task → pass worktree path as working directory
3. Agent works in isolation without touching main tree
4. When done: use finishing-a-development-branch skill to close
```

### Parallel agent execution

For independent tasks that need separate branches:
```bash
# Create multiple worktrees
git worktree add ../project-feat-a feature-a
git worktree add ../project-feat-b feature-b

# Each gets its own working directory, shares .git history
```

## Branch/worktree closure discipline

When implementation in a worktree is complete, use `finishing-a-development-branch` skill:

1. **Merge locally** — merge into base branch
2. **Push and create PR** — push branch, open PR for review
3. **Keep as-is** — leave worktree for later
4. **Discard** — remove worktree and branch

This avoids dangling worktrees and branch confusion.

## Safety rules

- Never create worktrees inside other worktrees
- Always verify the target branch exists before `git worktree add`
- Clean up worktrees after agent tasks complete
- Do not modify `.git/config` in worktrees — it shares the parent repo's config
