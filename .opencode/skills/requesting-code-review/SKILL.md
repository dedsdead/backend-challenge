---
name: requesting-code-review
description: "Use when requesting a focused review with standardized findings format (critical, important, informational) before commit or PR."
---

# Requesting Code Review

Use this skill when you want a consistent, high-signal review request. This skill works with the `review/*` agents and the `code-reviewer.md` template.

## How to use

### Step 1: Define review scope

```bash
# Get the diff to review
git diff main...HEAD --stat        # changed files summary
git diff main...HEAD               # full diff
```

Specify:
- Target: branch, PR, or specific files
- Changed file list
- Context: what was the goal of these changes

### Step 2: Spawn review agents

Use the `task` tool to run review agents in parallel:

```
For each relevant review agent, spawn via task:
- review/angular-reviewer → if frontend Angular changes
- review/nestjs-reviewer → if backend NestJS changes
- review/nextjs-reviewer → if Next.js changes
- review/security-sentinel → if auth, input handling, or API changes
- review/code-simplicity-reviewer → always, for YAGNI check
- review/performance-oracle → if hot path or database queries changed
```

Pass to each agent:
- The diff or file list
- The `code-reviewer.md` template format
- Context about what changed and why

### Step 3: Collect and merge findings

All agents output using the `code-reviewer.md` template:

```markdown
## Findings
### Critical
- [ ] `<file/symbol>`: `<issue>` - `<why it can break>`

### Important
- [ ] `<file/symbol>`: `<issue>` - `<risk>`

### Informational
- [ ] `<file/symbol>`: `<optional improvement>`
```

Deduplicate findings across agents. Merge same-issue reports.

### Step 4: Present to user

Present merged findings ordered by severity. Let user decide which to fix now vs defer.

## Output requirements

- Findings first, ordered by severity
- Each finding includes impacted files/symbols
- Keep summaries short; focus on risks and regressions
- Include suggested next steps

## When to skip review

- Single-line typo fixes
- Documentation-only changes (no code)
- Tests that only add new test cases (no production code changes)
