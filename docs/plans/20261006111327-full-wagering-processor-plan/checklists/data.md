# Data Requirement Quality Checklist

Plan: `docs/plans/20261006111327-full-wagering-processor-plan.md`
Domain: data

- [ ] CHK001 Are all five tables (wallet, wager_transaction, wallet_ledger_entry, inbox_message, outbox_message) specified with columns, types, and nullability? [Completeness]
- [ ] CHK002 Are DB-enforced invariants complete: unique keys (player+currency, idempotency, provider+external, reference+kind reversal partial `WHERE status='PROCESSED'`, inbox pair), CHECK balance >= 0, ledger immutability trigger? [Completeness]
- [ ] CHK003 Is money storage specified consistently everywhere as `numeric(20,2)` + `char(3)` currency with `decimal.js` in domain (never `number`)? [Consistency]
- [ ] CHK004 Is the replay snapshot (`result_balance_amount/currency`) specified as written once at original processing and read on replay (§7.7)? [Clarity]
- [ ] CHK005 Are `reference_attempts` and `reference_next_attempt_at` creation specified in migration 001 so Phase 7 needs no schema surprise? [Dependencies and assumptions]
- [ ] CHK006 Is migration discipline specified as an atomic chain (generate → drift-check → run locally immediately) for both 001 and 002? [Measurability]
- [ ] CHK007 Are migration `down()` requirements specified (drop trigger + partial unique index + tables + enums) for reversibility? [Completeness]
- [ ] CHK008 Is transaction atomicity specified: one SQL transaction = wallet lock + balance + ledger + inbox dedup + outbox rows? [Consistency]
- [ ] CHK009 Is the locking requirement specified precisely: `FOR UPDATE` on wallet row inside an open transaction, serialized per `walletId`? [Clarity]
- [ ] CHK010 Are outbox claim semantics specified (`FOR UPDATE SKIP LOCKED`, batch cap 50, due/attempt predicates) so concurrent publishers cannot double-claim? [Scenario coverage]
- [ ] CHK011 Is pagination specified as keyset on `(created_at, id)` (never OFFSET) with parameterized queries? [Measurability]
- [ ] CHK012 Are schema-level edge cases covered by required tests: duplicate insert rejection, negative-balance CHECK, trigger blocks UPDATE/DELETE, partial unique index rejects same-kind double reversal (accepts mixed kind), up/down round-trip? [Edge Case]
- [ ] CHK013 Is enum representation specified (native PG enums vs strings) consistently between entity decorators, migration, and domain enums? [Consistency]
- [ ] CHK014 Is the brainstorm five-table model carried into the plan with every unique, CHECK, and required index named? [Completeness]
- [ ] CHK015 Is the money storage decision (brainstorm ⚠️#14: numeric vs text) explicitly resolved with scale enforcement specified? [Clarity]
- [ ] CHK016 Is the greenfield assumption stated: migration 001 creates everything, no backfill, no lockstep deploy? [Dependencies and assumptions]
- [ ] CHK017 Are index requirements (ledger keyset cursor, outbox due-scan, PENDING_REFERENCE reprocessing) specified as schema deliverables, not incidental? [Coverage]
- [ ] CHK018 Are worker claim/lease semantics for 3+ in-process instances reflected as data-level requirements (SKIP LOCKED claim, no double-publish)? [Consistency]
