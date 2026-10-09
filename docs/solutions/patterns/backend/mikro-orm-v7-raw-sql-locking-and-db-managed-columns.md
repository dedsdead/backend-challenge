---
title: "MikroORM v7 Raw SQL, Locking, and DB-Managed Columns — Project Pattern"
problem_type: pattern
category: backend
components:
  - backend
tags:
  - patterns
  - mikro-orm
  - mikro-orm-v7
  - raw-sql
  - em-execute
  - parameter-binding
  - pessimistic-locking
  - skip-locked
  - transaction-context
  - repository
  - mappers
  - db-managed-columns
  - optimistic-locking
  - lock-contention-testing
  - outbox
module: wagering-processor
date: 2026-10-07
established_in: "Phases 2–3 (Domain Core, Persistence Layer — T017–T022) of docs/plans/20261006111327-full-wagering-processor-plan.md, 2026-10-07"
---

# Pattern: MikroORM v7 Raw SQL, Locking, and DB-Managed Columns

## Problem / When to Use This

Every repository method you add under `src/database/repositories/**` (and any raw SQL you run
against the `EntityManager` anywhere in Phases 4–9 — outbox `SKIP LOCKED` claims at T038,
pessimistic wallet locks, `PENDING_REFERENCE` reprocessor queries) walks into one of four traps
that either fail with a **misleading** error or fail **silently**:

1. `$n` placeholders in `em.execute()` never bind → PostgreSQL `42P02` "there is no parameter $1".
2. `em.getConnection().execute()` runs *outside* the caller's ambient transaction → a
   `FOR UPDATE SKIP LOCKED` claim can execute while no lock is retained by the caller's session.
3. A mapper-driven `em.assign()` that includes a **DB-managed** column wipes worker/ORM-owned
   state on every update (silent data loss).
4. A "locking" test that only proves the code *doesn't crash* — real lock proofs need a second
   forked EM, a gate promise, and `SET LOCAL lock_timeout`.

Use this whenever you write raw SQL, add a `save()` path for a new entity, or write an
integration test that claims rows or takes a row lock.

## Source of Truth Files

- `src/database/repositories/mikro-orm.repositories.ts` — the pattern's primary file:
  `UUID_RE` + `assertUuid`/`assertPositiveInt` (L41–L56), `findByIdForUpdate` (L67–L75),
  wallet `save()` version strip (L86–L89), wager `save()` strip (L150–L153),
  `sumByWallet` raw SQL (L214–L224), `claimDueBatch` tx guard + raw SQL (L316–L339)
- `src/database/mappers.ts` — `wagerTransactionToEntity` hardcoded DB-managed columns
  (L124–L125) vs `outboxMessageToEntity` domain-owned columns (L207–L218)
- `src/database/entities/wallet.entity.ts` — `version: { version: true }` (L26–L30)
- `tests/integration/repositories.spec.ts` — lock-contention test (L79–L116), erase
  regression (L160–L190), claim rollback affinity (L315–L350), fail-closed guard (L352–L355),
  `SKIP LOCKED` visibility (L357–L379)
- `tests/integration/schema.spec.ts` — `TRUNCATE` cleanup for the immutable ledger (L60–L66),
  scratch-schema `up`/`down` round-trip (L133–L214)
- Cross-references: `src/database/mikro-orm.config.ts` (L33–L37 `schemaGenerator.ignoreTriggers`),
  `src/database/migrations/Migration20261007000000_InitialMigration.ts` (L146–L161 `down()`)

## Current Implementation Snapshot

- **Raw SQL** runs through `(em as unknown as SqlEntityManager).execute(sql, [params])` with
  **`?` placeholders** (`sumByWallet` L216–L220, `claimDueBatch` L326–L336). The cast is needed
  because the injected token is plain `EntityManager` (see the bootstrap pattern), which does not
  expose `execute()`. `import type { SqlEntityManager } from '@mikro-orm/sql'` (L3) is type-only
  (`@mikro-orm/sql` is a transitive dep of `@mikro-orm/postgresql` — not in `package.json`).
- **Guards**: `assertUuid` (L46–L50) and `assertPositiveInt` (L52–L56) run at raw-SQL boundaries
  (`pageByCursor` L188–L189, `sumByWallet` L215, `claimDueBatch` L317) as defense-in-depth on top
  of parameter binding, per the comment at L43–L45.
- **Transaction affinity**: `claimDueBatch` takes the caller's `em` as an argument and executes
  via `em.execute`, never `em.getConnection().execute` (comment L323–L324). Lock-bearing raw SQL
  is preceded by a fail-closed `em.isInTransaction()` check (L318–L322) because raw SQL bypasses
  MikroORM's `checkLockRequirements` (which only guards `em.findOne({ lockMode: PESSIMISTIC_WRITE })`
  — see comment L68 on `findByIdForUpdate`).
- **DB-managed columns**: `wagerTransactionToEntity` hardcodes `referenceAttempts: 0` /
  `referenceNextAttemptAt: null` (L124–L125 — no domain field) and `walletToEntity` carries
  `version`; both are destructured out of the `em.assign` payload on the **update** path
  (wager L152, wallet L88). The create path keeps them (they match column defaults).
- **`em.getConnection().execute` is used only outside any ambient transaction**: one-off
  schema reads (`schema.spec.ts:32` `exec` helper), `TRUNCATE`/`DELETE` cleanup
  (`schema.spec.ts:62`, `repositories.spec.ts:63`), and single-statement assertions in tests.
- **Tests prove the claims**: lock contention with two forks + gate + `SET LOCAL lock_timeout`
  (`repositories.spec.ts:79–116`), claim rolled back with its transaction (L315–L350),
  `claimDueBatch` rejects outside a transaction (L352–L355), erase regression for the retry
  columns (L160–L190).

## Planned / Optional Extensions (If Applicable)

*Implemented since this pattern was written (Phase 4, 2026-10-08):* `findByIdForUpdate`
now has a production consumer — `src/modules/wagering/submit-transaction.use-case.ts`
(step 3) takes the wallet lock inside `em.transactional(...)`;
`src/database/repositories/mikro-orm.repositories.ts` also gained `findAppliedReversal`
(used there for per-type reversal checks) and `countByWallet`
(used by `src/modules/wallets/reconciliation.service.ts`).

*Implemented since this pattern was written (Phases 5–7, 2026-10-08/09):* the Phase 5
concurrency suite exists (`tests/concurrency/{hot-wallet,duplicate-flood,multi-instance}.spec.ts`);
`src/workers/outbox-publisher.worker.ts` calls `outboxRepo.claimDueBatch(tx, ...)`
**inside** `em.transactional(...)` (lines 87–98) — the pattern's transaction-bound claim
now has a production consumer, not just tests; and
`src/workers/pending-reference.worker.ts` persists `reference_attempts` /
`reference_next_attempt_at` on each retry (`scheduleRetry`, raw
`UPDATE wager_transaction SET reference_attempts = ?, reference_next_attempt_at = ?`
at lines 326–331 — deliberately *not* an entity-level write: those columns are not on
the domain `WagerTransaction`, so `em.assign`/`patch()` is not involved).

*Not implemented — do not assume they exist:*
- Injecting `SqlEntityManager` directly via `@Inject(SqlEntityManager)` is possible once
  `driver: PostgreSqlDriver` is on `forRootAsync` (bootstrap pattern G3) — **not adopted**; the
  convention is `@Inject(EntityManager)` + cast at the raw-SQL call site.
- A **separate** migration-discipline pattern doc (`backend/mikro-orm-migration-discipline.md`) is
  recommended — see "Related Patterns / Docs". This doc deliberately excludes it.

## Pattern Overview

Route all raw SQL through the *EntityManager's* `execute` with `?` placeholders and validation
guards, keep it inside the caller's transaction (and fail closed if a lock statement would run
without one), strip DB-managed columns out of mapper payloads before `em.assign` on updates, and
prove locking/claims with a two-EM gate test that fails fast on a held lock.

## Implementation Steps

### Step 1: Raw SQL via `em.execute` with `?` placeholders — `src/database/repositories/*.ts`

```ts
import type { SqlEntityManager } from '@mikro-orm/sql';

async sumByWallet(walletId: string): Promise<string> {
  assertUuid(walletId, 'walletId');                 // defense-in-depth, L43–L56
  const rows = (await (this.em as unknown as SqlEntityManager).execute(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT'
                              THEN money_amount ELSE -money_amount END), 0)::numeric(20,2) AS total
       FROM wallet_ledger_entry
      WHERE wallet_id = ?`,                          // `?` — NOT `$1`
    [walletId],
  )) as { total: string | number | null }[];
  const total = rows[0]?.total;
  return total == null ? '0.00' : String(total);
}
```

Key points:
- **`?` is the only placeholder style that binds** through `em.execute`. `$1`-style SQL raises
  `42P02` "there is no parameter $1" — the params array is consumed by MikroORM's query
  formatting, so `$n` positions receive nothing (observed; recorded at L43–L45).
- Cast `this.em as unknown as SqlEntityManager`: the DI token is `EntityManager` (value import +
  `@Inject`, per `docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md`), which has
  no `execute()` in its type.
- Keep the `@mikro-orm/sql` import **type-only** — the package is transitive; a value import would
  add a dependency you did not declare.
- Validate externally-supplied ids/limits with `assertUuid`/`assertPositiveInt` **before** the
  query: parameter binding prevents injection, guards prevent nonsense rows and give an
  actionable error instead of an empty result.
- Alias snake_case columns to camelCase in the SQL itself (`aggregate_id AS "aggregateId"`,
  L327–L329) so the result casts cleanly to the existing `*Row` interfaces from `mappers.ts`.

### Step 2: Transaction affinity + fail-closed lock guard — same file

```ts
async claimDueBatch(em: EntityManager, limit = 100): Promise<OutboxMessage[]> {
  assertPositiveInt(limit, 'limit');
  // FOR UPDATE SKIP LOCKED is only exclusive inside a transaction — fail closed
  if (!em.isInTransaction()) {
    throw new Error('claimDueBatch requires an active transaction (em.transactional() or begin())');
  }
  const rows = (await (em as unknown as SqlEntityManager).execute(
    `SELECT ... FROM outbox_message
      WHERE published_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY next_attempt_at ASC NULLS FIRST, occurred_at ASC
      LIMIT ? FOR UPDATE SKIP LOCKED`,
    [new Date().toISOString(), limit],
  )) as unknown as OutboxMessageRow[];
  return rows.map((r) => outboxMessageFromEntity(r));
}
```

Key points:
- **Take the caller's `em` as a parameter** (not `this.em`) so the statement joins the caller's
  transaction. Use `em.execute`, never `em.getConnection().execute`, for anything that must run
  inside an ambient transaction — the connection-level API does not join it (comment L323–L324).
  Proven by the rollback test: seeds + claim share one `begin()`/`rollback()` and nothing leaks
  (`repositories.spec.ts:315–350`).
- **Raw SQL bypasses `checkLockRequirements`.** MikroORM only raises "lock not allowed outside
  transaction" for `em.findOne({ lockMode: PESSIMISTIC_WRITE })` (comment L68). A raw
  `FOR UPDATE SKIP LOCKED` executed without a transaction acquires and immediately releases the
  lock — the claim "succeeds" while no lock is retained → double-claim. Guard with
  `em.isInTransaction()` and **throw** (fail closed); a test pins it (`repositories.spec.ts:352–355`).
- `em.getConnection().execute` remains correct for statements that *intend* to run outside any
  transaction: schema introspection, `TRUNCATE` cleanup, single-statement assertions.

### Step 3: Strip DB-managed columns from mapper-driven assigns — `src/database/mappers.ts` + `save()`

```ts
// mappers.ts — no domain field exists for these two columns (L124–L125):
referenceAttempts: 0,
referenceNextAttemptAt: null,

// mikro-orm.repositories.ts — update path must not carry them (L150–L153):
if (existing) {
  const { referenceAttempts: _ra, referenceNextAttemptAt: _rna, ...changes } = data;
  this.em.assign(existing, changes as any);
} else {
  this.em.create(WagerTransactionEntity, data as any);   // create: defaults are correct
}

// wallet version — managed by optimistic locking (L86–L89):
const { version: _version, ...changes } = data;
```

Key points:
- `em.assign` **overwrites every key present in the payload**. A reload → `repo.save()` round-trip
  through a mapper that hardcodes `0`/`null` silently resets worker-written scheduling state.
  Regression test: set `referenceAttempts = 3` at the entity level, reload, `repo.save`, assert the
  DB still says `3` (`repositories.spec.ts:160–190`).
- Rule: **every column is owned by exactly one writer.** Domain-owned → map from the domain object
  (outbox `attempts`/`nextAttemptAt`/`publishedAt`, `mappers.ts:206–217` — no strip needed).
  ORM-owned → strip on update (`version`, `onCreate`/`onUpdate` timestamps).
  DB/worker-owned with no domain field → strip on update and write only at the entity level
  (the spec's `patch()` shows the worker's path, `repositories.spec.ts:166–179`).
- Keep the strip **next to the `assign` call with a comment naming the columns** — a strip buried
  in the mapper would also affect the create path and hide ownership from readers.

### Step 4: Prove locking with a two-EM gate test — `tests/integration/*.spec.ts`

```ts
const em1 = orm.em.fork();
const em2 = orm.em.fork();
let ready!: () => void; const readyP = new Promise<void>((r) => (ready = r));
let release!: () => void; const gate = new Promise<void>((r) => (release = r));

const tx1 = em1.transactional(async (tx) => {
  await new MikroOrmWalletRepository(tx).findByIdForUpdate(wallet.id);  // takes the lock
  ready();
  await gate;                                                           // hold it open
});
await readyP;
try {
  await expect(
    em2.transactional(async (tx) => {
      await (tx as unknown as SqlEntityManager).execute(`SET LOCAL lock_timeout = '250ms'`);
      await new MikroOrmWalletRepository(tx).findByIdForUpdate(wallet.id);
    }),
  ).rejects.toThrow(/lock timeout/i);                                   // fails fast, no hang
} finally {
  release();
  await tx1;
}
```

Key points:
- Two `fork()`ed EMs = two sessions; a single EM cannot contend with itself.
- The **gate promise** keeps tx1 open while tx2 runs; `ready()` guarantees the lock is already
  held before tx2 starts (no timing race).
- **`SET LOCAL lock_timeout = '250ms'`** converts a would-be test hang into a fast, assertable
  `/lock timeout/i` rejection. Asserting only that the call resolves proves nothing about locking.
- For `SKIP LOCKED` tests, **commit the seed row first** so the second claimer can *see* it —
  otherwise MVCC invisibility (not the lock) would hide it and the test would pass vacuously
  (comment `repositories.spec.ts:361–363`).
- After any rejected `flush()`, call `em.clear()` — the failed entity stays pending and leaks into
  later tests (comments at `schema.spec.ts:380`, `repositories.spec.ts:157`).

## Complete Example (adding a new lock-bearing batch method + test)

```ts
// 1. repository method — src/database/repositories/mikro-orm.repositories.ts
async claimDueForWallet(em: EntityManager, walletId: string, limit = 50): Promise<WagerTransaction[]> {
  assertUuid(walletId, 'walletId');
  assertPositiveInt(limit, 'limit');
  if (!em.isInTransaction()) {                       // fail closed (Step 2)
    throw new Error('claimDueForWallet requires an active transaction');
  }
  const rows = (await (em as unknown as SqlEntityManager).execute(
    `SELECT id, status, reference_attempts AS "referenceAttempts", ...
       FROM wager_transaction
      WHERE wallet_id = ? AND status = 'PENDING_REFERENCE'
      ORDER BY reference_next_attempt_at ASC NULLS FIRST, created_at ASC
      LIMIT ? FOR UPDATE SKIP LOCKED`,               // `?` placeholders (Step 1)
    [walletId, limit],
  )) as unknown as WagerTransactionRow[];
  return rows.map((r) => wagerTransactionFromEntity(r));
}

// 2. save() for the same aggregate — strip DB-managed columns on update (Step 3)
const { referenceAttempts: _ra, referenceNextAttemptAt: _rna, ...changes } = data;
this.em.assign(existing, changes as any);

// 3. test — repositories.spec.ts shape (Step 4): seed → commit → em1.begin()/gate →
//    em2 SET LOCAL lock_timeout='250ms' → expect rejects /lock timeout/i → release in finally
// 4. gates: bun run validate && bun test
```

## Gotchas (all verified during Phases 2–3)

- **G1 — `$1` → `42P02`.** `em.execute("... WHERE id = $1", [id])` raises
  `there is no parameter $1`. Always `?`.
- **G2 — `getConnection().execute` leaks the transaction.** It does not join the ambient
  transaction, so lock-bearing statements run on the wrong session scope. Only use it where
  no transaction is intended (test setup/cleanup, standalone reads).
- **G3 — raw SQL skips `checkLockRequirements`.** `FOR UPDATE SKIP LOCKED` without a transaction
  does not throw — it silently claims without a retained lock. The `em.isInTransaction()` guard
  (L318–L322) is what fails closed.
- **G4 — `defineEntity` inference needs call-site casts.** `InferEntity`/`FilterQuery` degrade on
  the object-syntax entities, so repository code carries `{ ... } as FilterQuery<any>` (L63 etc.)
  and tests use `em.create(Entity, {...} as never) as any` (`schema.spec.ts:318`, `L474`, `L491`).
  Keep the casts at call sites; do not attempt to "fix" entity generics per entity.
- **G5 — `SqlEntityManager` is not a direct dependency.** `import type` from `@mikro-orm/sql`
  resolves via `@mikro-orm/postgresql`'s hoisted deps; never convert it to a value import without
  adding the package.
- **G6 — `em.execute` results are untyped.** Cast to the `*Row` interfaces from `mappers.ts`
  (`as unknown as OutboxMessageRow[]`, L337) and go through the existing `*FromEntity` mapper —
  never hand-roll a domain object from raw rows.

## Project-Specific Constraints

- [ ] Raw SQL in `src/**` goes through `(em as SqlEntityManager).execute(sql, [params])` with **`?`
      placeholders**; `$n` placeholders are forbidden.
- [ ] Lock-bearing raw SQL (`FOR UPDATE`, `FOR UPDATE SKIP LOCKED`) is preceded by
      `em.isInTransaction()` and throws when false — fail closed, never "best effort".
- [ ] `em.getConnection().execute` is reserved for statements that intentionally run outside a
      transaction (schema introspection, test `TRUNCATE`/`DELETE` cleanup, single-statement asserts).
- [ ] Guard externally-supplied ids/limits with `assertUuid`/`assertPositiveInt`
      (`mikro-orm.repositories.ts:46–56`) before the query.
- [ ] Every mapper output column has exactly one owner; ORM/DB-managed columns (`version`,
      `referenceAttempts`, `referenceNextAttemptAt`, `onCreate`/`onUpdate` fields) are
      **destructured out of the `em.assign` payload on the update path** with a comment naming them.
- [ ] Raw-SQL results are cast to `mappers.ts` `*Row` types and converted via `*FromEntity`.
- [ ] Lock/claim behavior is proven by a two-fork + gate + `SET LOCAL lock_timeout` test that
      *rejects* fast; `SKIP LOCKED` tests commit the seed first (visibility vs. lock).
- [ ] Tests cleaning `wallet_ledger_entry` use `TRUNCATE TABLE wallet_ledger_entry` (row trigger
      blocks `DELETE` — `schema.spec.ts:60–62`); `em.clear()` after any rejected `flush()`.
- [ ] Every change passes `bun run validate` (`tsc --noEmit`; Bun never type-checks) and `bun test`.

## Anti-Patterns (What NOT to Do)

- ❌ Don't write `$1`/`$2` placeholders in `em.execute` — you get `42P02`, not a useful message (G1).
- ❌ Don't use `em.getConnection().execute` for claims, lock reads, or anything the caller's
  transaction must own (G2).
- ❌ Don't rely on MikroORM to reject a raw `FOR UPDATE …` outside a transaction — guard it yourself (G3).
- ❌ Don't interpolate externally-supplied values into SQL in `src/**` (`WHERE id = '${id}'` appears
  only in tests with `v4()` fixtures); use `?` + params.
- ❌ Don't let a new mapper emit a value for a column it does not own without stripping it on the
  update path — `em.assign` will overwrite worker/ORM state (silent wipe; Step 3).
- ❌ Don't `DELETE FROM wallet_ledger_entry` in tests — the immutability trigger raises; `TRUNCATE`
  skips row triggers.
- ❌ Don't assert locking by merely awaiting two transactions sequentially, or without
  `lock_timeout` — a contended lock hangs the suite instead of failing it (Step 4).
- ❌ Don't fix `defineEntity` inference per entity with bespoke generics — use the codebase's
  call-site cast convention (G4).

## Related Patterns / Docs

- `docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md` — DI token
  (`@Inject(EntityManager)` value import), integration harness, `bun run validate` gates
- `docs/solutions/patterns/backend/mikro-orm-migration-discipline.md` — **planned follow-up
  entry** for candidate #5: `schemaGenerator.ignoreTriggers` (`mikro-orm.config.ts:35–37`),
  `down()` must not drop migrator-owned `mikro_orm_migrations`
  (`Migration20261007000000_InitialMigration.ts:152–160`), immutable-ledger `TRUNCATE` policy,
  `.snapshot-*.json` gitignore, scratch-schema `up`/`down` round-trip test
  (`schema.spec.ts:133–214`). Excluded here — different activity (schema changes vs. repository methods).
- `.opencode/skills/typeorm/SKILL.md` — atomic chain generate → drift-check → run analogue for
  `bun run mikro-orm migration:check` (plan T020)
- Plan tasks: T018 (entities), T020 (migration + trigger), T022 (locking/keyset/claims),
  T038 (future outbox `SKIP LOCKED` publisher)

## Safe Change Checklist for Future AI Work

1. **New raw SQL** → Step 1: `em.execute` + `?` + `assertUuid`/`assertPositiveInt`; cast results to
   a `mappers.ts` `*Row`.
2. **New lock statement** → Step 2: take the caller's `em`, `isInTransaction()` guard, then
   Step 4 test (two forks, gate, `SET LOCAL lock_timeout`).
3. **New entity or new column** → Step 3: classify ownership (domain / ORM / DB-worker); if it is
   not domain-owned, strip it in `save()`'s update branch and add the erase regression test.
4. **New integration test touching the ledger** → `TRUNCATE` cleanup, `em.clear()` after a
   rejected flush, commit seeds before `SKIP LOCKED` assertions.
5. **Schema/migration change** → follow the planned `mikro-orm-migration-discipline` doc (ignore
   triggers, keep `mikro_orm_migrations` in `down()`, run `migration:check`).
6. **Gates (fresh evidence)**: `bun run validate` (exit 0) → `bun test` (0 fail) with Docker
   Postgres healthy (`docker compose up -d --wait`).
