---
name: verification-before-completion
description: "Use before any completion/success claim to enforce fresh verification evidence (build/lint/tests/repro command) and explicit limitations when verification is partial."
---

# Verification Before Completion

Never claim "done", "fixed", "passing", or "ready" without fresh evidence from commands run in the current execution context.

## Iron Rule

No completion claims without command evidence.

## Mandatory flow

1. Identify which command validates the claim.
2. Run the command fully.
3. Check exit code and meaningful output.
4. Report the claim with evidence.
5. If full verification is not possible, state limitations explicitly.

## Evidence format

- Command executed: `<command>`
- Result: `exit code 0|non-zero`
- Key output: `<1-2 relevant lines>`
- Conclusion: `<what is verified>`

## Typical mappings

- Build claim -> `npm run build` when the user explicitly requests a full build
- Fast validation claim -> `npm run validate` or `tsc --noEmit`
- Lint claim -> linter command output with zero errors
- Bug fix claim -> reproduction command/script no longer fails
- Migration safety claim -> migration run and drift check evidence

## Anti-patterns

- "Should be fine now"
- "Looks correct"
- "I think it works"
- Using old command output as evidence

## In this workflow

- Apply at the end of `/pwf-work` and `/pwf-work-plan`.
- If evidence is partial, still provide status, but mark it as limited and list next verification steps.
