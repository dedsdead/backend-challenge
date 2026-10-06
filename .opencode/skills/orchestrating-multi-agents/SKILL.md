---
name: orchestrating-multi-agents
description: "Use for explicit multi-subagent orchestration when tasks are independent and parallelization improves quality or speed while preserving deterministic merge."
---

# Orchestrating Multi-Agents

Use this skill when a task benefits from parallel specialist analysis or implementation.

## When to use

- Independent research tracks (architecture, security, performance)
- Cross-repo impact analysis
- Large review surfaces requiring specialized reviewers
- Structured synthesis from multiple viewpoints

## Guardrails

1. Keep one orchestrator owner for final merge.
2. Split tasks by clear responsibility boundaries.
3. Run only independent tasks in parallel.
4. Merge into one deterministic decision/report.
5. For high-risk autonomous actions, ask user before execution.

## Execution pattern

1. Define 2-4 parallel lanes with explicit deliverables.
2. Launch subagents simultaneously.
3. Require concise, structured outputs from each lane.
4. Resolve conflicts explicitly (do not average contradictions).
5. Produce final plan/report with rationale and chosen direction.

## Agent Reference

Reference agents using paths relative to `.opencode/agents/`:

- `agents/<category>/<agent-name>`

Example: `agents/review/architecture-strategist`

## Anti-patterns

- Parallelizing dependent tasks that need sequencing
- Letting subagents mutate broad code areas without clear ownership
- Returning multiple conflicting answers without a final merged decision
