---
name: receiving-code-review
description: "Use when processing review feedback to prioritize critical findings and resolve comments safely before commit."
---

# Receiving Code Review

Use this skill when you have review findings (from `pwf-review`, a PR review, or agent output) and need to resolve them systematically.

## Rule

Prioritize critical findings first. Do not dismiss without evidence.

## Flow

### Step 1: Parse and group by severity

```bash
# If review is in a file, extract findings
grep -E "^### (Critical|Important|Informational)" <review-file>
```

Group into:
- **Critical** — must fix, breaks behavior or security
- **Important** — should fix, risk or maintainability
- **Informational** — optional improvement

### Step 2: Fix critical issues first

For each critical finding:
1. Read the affected file(s)
2. Apply the fix
3. Run verification: `npm run validate` or project equivalent
4. Mark as resolved

### Step 3: Fix important issues

Same process as critical, but can be batched.

### Step 4: Address informational (optional)

Fix if quick and low-risk. Defer if complex or opinion-based.

### Step 5: Re-verify

```bash
npm run validate  # or tsc --noEmit
```

Do not claim completion without fresh verification evidence.

## Output format

Summarize after processing all findings:

```
Resolved:
- [critical] <file>: <what was fixed>
- [important] <file>: <what was fixed>

Deferred:
- [info] <file>: <what was deferred> — rationale: <why>

Verification:
- Command: npm run validate
- Result: 0 errors
```

## Integration with pr-comment-resolver

When review findings come from a PR comment thread, use `workflow/pr-comment-resolver` agent to implement the changes. That agent reads the PR comments and applies fixes directly.
