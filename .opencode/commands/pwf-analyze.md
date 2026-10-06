---
description: "Read-only cross-artifact analysis for plans/docs/tasks consistency. Detects gaps, duplication, ambiguity, and unmapped work."
---

# Cross-Artifact Analysis (Read-Only)

Use this command to assess consistency and coverage before implementation.

## Input

<analyze_input> $ARGUMENTS </analyze_input>

If empty, ask: "Which plan should I analyze? (e.g. `docs/plans/20260312-feature-plan.md`)"

---

## Scope

Target artifacts:
- Plan file in `docs/plans/`
- Related docs in `docs/modules/`, `docs/features/`, `docs/lambdas/`
- Related checklists in `docs/plans/<plan-slug>/checklists/` (if present)
- `docs/solutions/patterns/critical-patterns.md` (if exists)

**Strictly read-only**: do not modify any files.

---

## Analysis passes

1. Duplication:
   - repeated requirements or acceptance criteria with conflicting phrasing.
2. Ambiguity:
   - vague terms without measurable criteria.
3. Underspecification:
   - requirements lacking concrete success criteria.
4. Coverage:
   - requirement without task,
   - task without requirement,
   - NFRs not reflected in tasks.
5. Inconsistency:
   - terminology drift across plan/docs/checklists,
   - entity/API mismatch between sections.
6. Rule/pattern alignment:
   - contradictions with critical project patterns.

---

## Output format

Produce:

```markdown
## Specification Analysis Report
| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|

## Coverage Summary
| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|

## Unmapped Tasks
- ...

## Metrics
- Total requirements:
- Total tasks:
- Coverage %:
- Ambiguity count:
- Critical issues count:
```

Severity:
- `CRITICAL`: blocks safe implementation
- `HIGH`: likely rework/risk
- `MEDIUM`: should fix for quality
- `LOW`: polish

At the end, ask:
"Would you like concrete remediation edits for the top issues?"

## Next Recommended Commands

- `/pwf-clarify <same plan path>` for unresolved high-impact ambiguities
- `/pwf-checklist <same plan path>` to strengthen requirement quality
- `/pwf-work-plan <same plan path> Phase N` only when CRITICAL issues are zero

## Decision Gate (Go / No-Go)

At the end of every analysis, return one of:

- `Go`: no CRITICAL issues found
- `No-Go`: one or more CRITICAL issues found

When `No-Go`, list the top blocking issues and recommended fix order.
