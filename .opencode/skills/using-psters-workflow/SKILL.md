---
name: using-psters-workflow
description: "Meta-skill for selecting and invoking the right workflow skill before acting; use when starting or switching task type to avoid bypassing required discipline."
---

# Using Psters Workflow (Meta-Skill)

Use this skill to decide which workflow skill must be applied before responding or implementing.

## Rule

If there is even a small chance a workflow skill applies, invoke it first.

## Extremely important

If there is a 1% chance a skill is relevant, use it.
No rationalization. No skipping because task looks "simple".

## Priority order

1. Process discipline skills:
   - `systematic-debugging`
   - `verification-before-completion`
2. Execution-context skills:
   - `git-worktree`
   - `finishing-a-development-branch`
   - `orchestrating-multi-agents`
3. Domain/convention skills:
   - `nestjs-conventions`
   - `angular-conventions`
   - `nextjs-conventions`
   - `deploy-lambda`
   - `commit-changes`

## Red flags

- Acting immediately without choosing a skill path.
- Declaring completion before verification.
- Proposing bug fixes before root-cause analysis.
- Closing worktree/branch ad hoc without a finishing checklist.
- "I will quickly check files first."
- "This does not need a skill."
- "I remember the skill, no need to read."

## Quick routing

- Bug or failing behavior -> `systematic-debugging`
- End of implementation -> `verification-before-completion`
- Need isolated parallel branch -> `git-worktree`
- Need explicit multi-subagent parallelization -> `orchestrating-multi-agents`
- Work finished and branch decision needed -> `finishing-a-development-branch`

When uncertain, prefer discipline over speed.
