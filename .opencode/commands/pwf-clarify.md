---
description: "Ask up to 5 high-impact clarification questions for a plan/feature scope, then write a clarifications artifact in docs/plans/."
---

# Clarify Requirements Before Planning/Execution

Use this command to reduce ambiguity before `/pwf-plan` finalization or before `/pwf-work-plan` execution.

## Input

<clarify_input> $ARGUMENTS </clarify_input>

If empty, ask: "Which plan should I clarify? (e.g. `docs/plans/20260312-feature-plan.md`)"

---

## Step 1: Load context

1. Identify target plan:
   - If input is a `docs/plans/*.md` path, use it directly.
   - Otherwise, find the most relevant recent plan by keywords.
2. Read target plan fully.
3. Read related docs when applicable:
   - `docs/modules/<module>.md`
   - `docs/features/<feature>.md`
   - `docs/infrastructure/<component>.md`
   - `docs/solutions/patterns/critical-patterns.md` (if exists)

---

## Step 2: Ambiguity scan (taxonomy)

Scan and classify each category as `Clear | Partial | Missing`:

1. Functional scope and success criteria
2. Domain/data model and lifecycle transitions
3. UX/interaction flows (empty/error/loading states)
4. NFRs (security, performance, reliability, observability)
5. Integration boundaries and failure modes
6. Edge cases and conflict/concurrency handling
7. Terminology consistency
8. Completion signals (objective done criteria)

---

## Step 3: Ask targeted questions

Ask up to **5 questions total**, **one at a time**, prioritizing highest impact.

Question rules:
- Prefer multiple choice (2-5 options).
- Provide a recommended option and 1-2 line reasoning.
- Accept short custom answer when needed.
- Skip low-impact questions that do not change implementation.

Stop early when:
- Critical ambiguities are resolved, or
- user says "done"/"proceed", or
- question limit is reached.

---

## Step 4: Write clarifications artifact

Write/update:

- `docs/plans/<plan-slug>.clarifications.md`

Required structure:

```markdown
# Clarifications — <Plan Title>

## Source Plan
- `docs/plans/<plan-file>.md`

## Session YYYY-MM-DD
- Q: ...
  - Recommendation: ...
  - Final Answer: ...
  - Impact on Plan: ...

## Coverage Summary
| Category | Status | Notes |
|----------|--------|-------|
```

If the file already exists, append a new session section (do not overwrite old sessions).

---

## Step 5: Update plan references

In the target plan file:

1. Add/update a `## Clarifications` section with:
   - link to the clarifications file,
   - key resolved decisions (short bullets),
   - any deferred open points.
2. If a clarified answer changes a plan task or acceptance criterion, update the relevant section directly.

---

## Output

Report:
- questions asked/answered count,
- plan file updated,
- clarifications file path,
- categories resolved vs deferred,
- recommendation: proceed to `/pwf-plan` finalization or run `/pwf-work-plan`.

## Next Recommended Commands

- `/pwf-checklist <same plan path>` to validate requirement quality
- `/pwf-analyze <same plan path>` for cross-artifact consistency
- `/pwf-work-plan <same plan path> Phase N` when ready to execute
