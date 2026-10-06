---
name: docs-maintenance-after-work
description: "Run standardized post-implementation documentation maintenance and quality checks."
---

# Docs Maintenance After Work

Use this skill after implementation to keep project docs synchronized with reality and prevent drift.

## Trigger conditions

- End of `/pwf-work` execution.
- End of `/pwf-work-plan` phase execution.

## Core flow

1. Run `doc-shepherd` (always).
2. Run `plan-sync` when work maps to an active plan/work-plan context.
3. Conditionally run specialized doc writers:
   - Module/service documentation agents
   - Frontend/UI documentation agents  
   - Infrastructure/deployment documentation agents
4. Run `pattern-extractor` when a reusable pattern emerged.
5. Apply documentation quality gate.

## Agent Reference

Reference agents from `agents/docs/`:
- `doc-shepherd`, `plan-sync`, `pattern-extractor`
- Specialized writers for backend, frontend, infrastructure as applicable

## Inputs required for doc agents

- `diff` — relevant git diff for implementation scope
- `changed_files` — modified/created/deleted file list
- `work_summary` — short implementation summary

## Documentation quality gate

Before claiming completion:

1. **Specificity** — real file/symbol references, no vague text.
2. **State clarity** — clear implemented vs planned separation.
3. **Operational usefulness** — invariants/gotchas/checklists are concrete.
4. **Contract accuracy** — APIs/DTOs/entities/flows match current code.
5. **Cross-doc consistency** — no contradictions with critical patterns.
6. **Signal over noise** — concise and actionable content.

## Constraints

- Never skip docs maintenance on work/work-plan flows.
- Do not delete protected docs trees.
- If uncertain, mark assumptions explicitly and suggest follow-up.
