# Runbooks

Catalog of operational runbooks: what they cover, who owns them, and how to write one.

## Index

| Runbook | Service / operation | Owner | Status |
|---|---|---|---|
| _No runbooks yet — add a row when creating `docs/runbooks/<name>.md`._ | | | |

## Ownership and escalation

- Every runbook names a single **owner** (person or team) responsible for keeping it
  accurate; stale runbooks are corrected, never silently deleted.
- Each runbook must state its **escalation path** (who to contact when the steps
  don't resolve the incident).
- Runbooks describe operations that can be executed and verified; they link to
  source-of-truth docs instead of duplicating configuration.

## Required runbook template sections

Every runbook uses these stable headings (in this order):

1. `# <Title>` — one-line purpose.
2. `## Symptoms / trigger` — what indicates this runbook is needed.
3. `## Preconditions` — access, tools, and state required before acting.
4. `## Diagnosis` — how to confirm the cause (commands, queries, dashboards).
5. `## Procedure` — numbered, executable steps with expected output per step.
6. `## Verification` — how to prove the system is healthy again.
7. `## Rollback / escalation` — how to undo the steps or whom to escalate to.
8. `## References` — links to [architecture](../architecture.md),
   [infrastructure](../infrastructure.md), [environments](../environments.md),
   and related runbooks.

## Creating a runbook

Run `/pwf-doc-runbook <service-or-operation>` to scaffold one, then fill every
section with concrete commands — no "TBD" steps.
