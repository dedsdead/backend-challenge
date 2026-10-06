---
description: "Create or refresh operational runbooks under docs/runbooks/ with incident-ready structure (diagnosis, mitigation, rollback, escalation, and post-incident follow-up)."
---

# Build Operational Runbooks

Use this command to create or update operational runbooks for services and critical workflows.
Runbooks should be practical during incidents: short, specific, and executable.

## Input

<doc_runbook_target> $ARGUMENTS </doc_runbook_target>

If empty, ask:
"Which runbook should I create or update? (example: `payments-api` or `deploy-backend`)"

Special target:
- `index` -> refresh `docs/runbooks/README.md`

## Canonical paths

- Runbook file: `docs/runbooks/<slug>.md`
- Index file: `docs/runbooks/README.md`

## Workflow

1. Ensure `docs/runbooks/` exists.
2. Determine whether this is `create` or `update`:
   - if runbook file exists, update it in place (anti-drift),
   - if not, create new canonical file.
3. Read related source docs before writing:
   - `docs/infrastructure.md`
   - `docs/architecture.md`
   - `docs/integrations.md`
   - `docs/environments.md`
4. Write/update runbook with concrete command paths, dependencies, and failure handling.
5. Update `docs/runbooks/README.md` with runbook index entry.

## Required runbook structure

- `Overview`
- `Scope and Ownership`
- `Access and Prerequisites`
- `Monitoring and Alerts`
- `Common Failure Scenarios`
- `Diagnosis Steps`
- `Mitigation and Recovery`
- `Rollback Procedure`
- `Escalation`
- `Post-Incident Checklist`

## Output

Report:
- runbook path created/updated,
- index updates,
- missing operational data still needed from the user.

## Next Recommended Commands

- `/pwf-doc-foundation all` when baseline docs are stale or incomplete
- `/pwf-doc update` for full consistency scan
- `/pwf-review` if runbook changes reflect high-risk operational changes
