# UX Requirement Quality Checklist (API ergonomics — no UI in scope)

Plan: `docs/plans/20261006111327-full-wagering-processor-plan.md`
Domain: ux

- [ ] CHK001 Is it specified that no UI is in scope, so "UX" means provider/operator API ergonomics only? [Clarity]
- [ ] CHK002 Is every success response body shape defined (field names, types, example) so a client can integrate without guessing? [Completeness]
- [ ] CHK003 Are error messages human-readable and stable (machine-readable `code` separate from `message`) for all failure classes? [Clarity]
- [ ] CHK004 Is `Retry-After` specified for 503 so clients know when to retry, and is retry safety (idempotency) implied by the contract? [Edge Case]
- [ ] CHK005 Can a client distinguish "retry the same request safely" (replay/503) from "do not retry" (400/409/422) from the response alone? [Consistency]
- [ ] CHK006 Is the reconciliation endpoint response (`storedBalance`, `calculatedBalance`, `difference`, `consistent`, `checkedEntries`) specified with types and semantics? [Measurability]
- [ ] CHK007 Is the pending-status UX (202 + how the client learns the final outcome: poll `GET /wagering/transactions/:id` or event) described end-to-end? [Scenario coverage]
- [ ] CHK008 Are operator-facing outcomes specified (DLQ visibility, divergence flag never auto-corrected) with observable signals? [Coverage]
- [ ] CHK009 Are request payload limits/validation feedback (which field failed, why) specified for provider-developer debuggability? [Edge Case]
- [ ] CHK010 Is correlation ID propagation (`x-correlation-id` request header → response header → logs) specified so support can trace a request? [Completeness]
- [ ] CHK011 Are README Setup/Commands documented as requirements (T052) so onboarding ergonomics are graded deliverables, not afterthoughts? [Dependencies and assumptions]
- [ ] CHK012 Are the three brainstorm audiences (providers, operators, evaluators) each mapped to concrete requirements in the plan? [Coverage]
- [ ] CHK013 Is "no UI and no admin console" explicitly recorded as a scope boundary so the absence of UI requirements is intentional? [Clarity]
- [ ] CHK014 Are the seven brainstorm Open Questions either resolved in the plan or carried as explicit, visible assumptions? [Dependencies and assumptions]
- [ ] CHK015 Is the evaluator-facing documentation burden (README commands, root ARCHITECTURE.md decisions/trade-offs/limitations) specified as requirements? [Completeness]
