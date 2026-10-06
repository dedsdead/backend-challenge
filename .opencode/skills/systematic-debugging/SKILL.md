---
name: systematic-debugging
description: "Use for bugs, failing tests, and unexpected behavior; enforce a 4-phase root-cause-first debugging process before implementing fixes."
---

# Systematic Debugging

Do not jump to fixes. Find root cause first.

## 4-phase process

### 1) Root-cause investigation

- Reproduce issue with explicit steps.
- Read errors/stack traces fully.
- Check recent changes likely to affect behavior.
- Gather targeted evidence at component boundaries.

### 2) Pattern identification

- Find similar working code/path.
- Compare working vs failing flow.
- List concrete differences.

### 3) Hypothesis test

- Form one hypothesis at a time.
- Apply the smallest possible change to test it.
- Validate hypothesis before moving to additional changes.

### 4) Minimal fix + validation

- Implement only the root-cause fix.
- Re-run reproduction and verification commands.
- Confirm no collateral regressions in affected scope.

## Guardrails

- If 2+ blind fixes already failed, restart at Phase 1.
- If 3+ attempts fail, escalate: question architecture/pattern choice.
- Never report success without applying `verification-before-completion`.

## Supporting techniques (use when applicable)

- `root-cause-tracing.md` for deep stack tracing.
- `condition-based-waiting.md` for async/timing issues.
- `defense-in-depth.md` for post-fix boundary hardening.
- `find-polluter.sh` when isolated test passes but suite fails.

## In this workflow

- Trigger automatically for `/pwf-work` and `/pwf-work-plan` when the task is bug/debug/failure oriented.
