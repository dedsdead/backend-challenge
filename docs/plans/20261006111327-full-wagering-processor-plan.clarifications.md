# Clarifications — Full Wagering Processor

## Source Plan
- `docs/plans/20261006111327-full-wagering-processor-plan.md`
- Resolved from input `docs/brainstorms/20261006110158-full-wagering-processor-brainstorm.md` (its derived plan).

## Session 2026-10-06

- **Q: Reversal uniqueness semantics — spec §7.4 says "same reference cannot be reversed twice *by the same operation type*", but the plan only said "single reversal" with no mechanism. How is it enforced?**
  - Recommendation: Per-type enforcement, literal spec reading; detect existing same-kind reversal via query.
  - Final Answer: **Per-type, enforced by DB partial unique index** — allow mixed-type reversals (e.g. REFUND then ROLLBACK on one BET); block a second reversal of the same type with `REFERENCE_ALREADY_REVERSED`; backstop the rule with a partial unique index on `(reference_transaction_id, kind)` where status is terminal-applied, aligning with spec §5.9 DB-enforcement.
  - Impact on Plan: T018 (entity/index), T020 (migration 001 raw index SQL if decorator unsupported), T026 step 5 (detection wording), T029 (mixed-type e2e test).

- **Q: HTTP 202 `status: PENDING` is in the mapping but no code path produces it (sync submit always lands PROCESSED / REJECTED / PENDING_REFERENCE). Keep or drop?**
  - Recommendation: Drop — remove the dead contract value; `PENDING` stays an internal in-flight enum member only.
  - Final Answer: **Drop `PENDING` from the HTTP mapping.** 202 is returned only with `status: PENDING_REFERENCE`.
  - Impact on Plan: Proposed Solution §4 status mapping, T027 response codes, master checklist T027 line.

- **Q: What does an authenticated caller without the required role receive? The plan adds roles guards but never defines the status.**
  - Recommendation: 403 FORBIDDEN with a distinct code; reserve 401 for missing/invalid tokens (OAuth convention).
  - Final Answer: **403 `FORBIDDEN` (code `ROLE_FORBIDDEN`)**; 401 strictly for authentication failure.
  - Impact on Plan: Proposed Solution §4 mapping, T028 exception/guard mapping, T044 guard behavior.

- **Q: Should `/health/ready` include a Keycloak probe?**
  - Recommendation: No — spec §9 defines ready as "PostgreSQL and SQS reachable"; decouple availability from the IdP.
  - Final Answer: **PostgreSQL + SQS only; Keycloak explicitly excluded from readiness** (auth failures surface as 401/403 on requests, not readiness).
  - Impact on Plan: T047 — exclusion made explicit.

- **Q: Cross-currency conflict is unit-tested (T017) and guarded (T026) but has no end-to-end case. Add one?**
  - Recommendation: Yes — cheap integration assertion beyond the spec floor (§13 lists currency conflict under unit tests only).
  - Final Answer: **Add integration assertion** — submit with currency ≠ wallet currency → 422 `CURRENCY_MISMATCH`, balance unchanged, no ledger entry.
  - Impact on Plan: T029 gains the cross-currency case.

## Coverage Summary

| Category | Status | Notes |
|----------|--------|-------|
| 1. Functional scope and success criteria | Clear | 18 ACs; 100% task coverage (analyze: Go) |
| 2. Domain/data model and lifecycle transitions | Resolved | Reversal semantics (per-type + partial index); dead `PENDING` removed |
| 3. UX/interaction flows | Clear | API-only scope; pending outcome → poll `GET /wagering/transactions/:id` |
| 4. NFRs | Resolved | 403 role status added; readiness scope pinned (PG+SQS, no Keycloak) |
| 5. Integration boundaries and failure modes | Clear | Failure-mode table complete; DLQ/outbox scenarios tested |
| 6. Edge cases and conflict/concurrency | Resolved | Cross-currency e2e added; hot-wallet/dup-flood already covered |
| 7. Terminology consistency | Clear | No drift across plan/checklists/foundation docs |
| 8. Completion signals | Clear | Per-phase `bun run validate` + suite gates + evidence format |
