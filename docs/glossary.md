# Glossary

Canonical domain and technical terminology for this project. When a term appears in
code, docs, or conversations, this file defines its meaning. Sources: challenge
specification (`../README.md`) and [architecture.md](architecture.md).

## Domain Terms

| Term | Definition | Source of truth |
|---|---|---|
| Wallet | Aggregate root holding a player's balance for one currency; at most one per `playerId` + `currency`; balance never negative. | spec §6.2, [architecture.md](architecture.md) |
| Money | Immutable decimal-string value (`amount` + ISO-4217 `currency`, scale 2); never `number`/float. | spec §6.1 |
| WagerTransaction | A provider operation (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, internal `OPENING`) with a status lifecycle. | spec §6.3 |
| Ledger entry (`WalletLedgerEntry`) | Immutable record of one balance movement: direction, money, `balanceBefore`, `balanceAfter`. | spec §6.4 |
| Round | A game round (`roundId`) grouping related operations; reference resolution stays within one round. | spec §7 |
| Reference | The transaction a `REFUND`/`ROLLBACK` reverts, resolved by `(providerId, referenceExternalTransactionId)`. | spec §7 |
| Reconciliation | Recomputing balance from the ledger and reporting (never silently fixing) divergence. | spec §9 |
| Double-entry ledger | Optional differential: paired debit/credit entries per transaction. Not required. | spec §6.4 |
| `PENDING` | Internal in-flight state only — never returned in HTTP responses (clarified 2026-10-06); spec §6.3: accepted, not yet applied. | spec §6.3, plan §4 |
| `PENDING_REFERENCE` | Waiting for the referenced transaction; reprocessed by scheduled worker with backoff. Columns `reference_attempts` / `reference_next_attempt_at` exist since migration 001; the worker itself landed in Phase 7 (`src/workers/pending-reference.worker.ts`). | spec §7.1 |
| `PROCESSED` / `REJECTED` / `FAILED` | Terminal states — no further transitions; attempting one is a programming error. | spec §6.3 |
| `failureCode` | Stable, machine-readable reason for rejection/failure; taxonomy defined by the implementation. | spec §7.2 |
| `code` | Stable HTTP error-class identifier in API response bodies (e.g. `UNAUTHORIZED`, `ROLE_FORBIDDEN`, `VALIDATION_ERROR`) — distinct from `failureCode`, which is domain-level. | plan §4 |
| `transact:write` / `transact:read` | Keycloak realm roles: write required for POST endpoints, read for GET; enforced by `src/auth/roles.guard.ts` against `realm_access.roles` (fail-closed `403 ROLE_FORBIDDEN`). | `src/auth/roles.guard.ts`, plan T043/T044 (implemented Phase 8) |
| Idempotency conflict | Same `Idempotency-Key` with a different `payloadHash` — distinct from a replay. | spec §9 |
| Lock conflict | A `findByIdForUpdate` wait exceeding 50ms, indicating contention on the wallet row; counted by `wageringLockConflictsTotal` metric (Phase 5, T033). | plan T033 |
| Transaction metric | Per-status counters (`processed`, `rejected`, `pendingReference`) and processing latency histogram (`wageringProcessingSeconds`) recorded at transaction completion (Phase 5, T033); Prometheus instruments served at `GET /metrics` since Phase 8 (T046). | plan T033 |

## Technical Terms and Acronyms

| Term | Definition |
|---|---|
| Inbox | Persistent dedup record per `(consumerName, messageId)`; prevents duplicate effects from redelivery. `inbox_message` table + repository exist (Phase 3); rows are written by `SubmitTransactionUseCase` for SQS ingress since Phase 4 (`src/modules/wagering/submit-transaction.use-case.ts`, step 1); the SQS consumer that invokes it landed in Phase 6 (`src/messaging/wager-transaction.consumer.ts`). |
| Outbox | Event rows written in the same SQL transaction as the financial change; a worker publishes them post-commit. `outbox_message` table + repositories (incl. `claimDueBatch`) exist (Phase 3), the Phase 4 use cases enqueue rows in the same transaction, and the publisher worker has published them since Phase 7 (`src/workers/outbox-publisher.worker.ts`). |
| At-least-once | Delivery guarantee assumed everywhere: duplicates are normal, effects must be idempotent. |
| Lost update | Concurrent writes silently overwriting each other; prevented by the chosen concurrency strategy per `walletId`. |
| Optimistic locking | Conflict detection via `version` increment with bounded retry. |
| Pessimistic locking | Row-level lock held for the duration of the balance change. Implemented as `WalletRepository.findByIdForUpdate` (`LockMode.PESSIMISTIC_WRITE` in `src/database/repositories/mikro-orm.repositories.ts`); called inside `em.transactional(...)` by `SubmitTransactionUseCase` (step 5) since Phase 4 — under the pinned EM/DI decision every wallet read is also wrapped in a short transaction (root `EntityManager` as transaction factory, per-tx repositories, `allowGlobalContext: false`). The Phase 5 + 9 concurrency suites (T030–T033, T050) prove contention behavior: hot-wallet (two concurrent bets on one wallet), duplicate-flood (50× same key), multi-instance (3 logical instances, mixed workload), distinct wallets parallel, and restart-consistency sweep all pass. |
| Keyset cursor (`LedgerCursor` / `LedgerPage`) | Newest-first pagination on `(created_at, id)` via `WalletLedgerEntryRepository.pageByCursor` — parameterized, no `OFFSET`; `nextCursor` is `null` on the last page. |
| DLQ | Dead-letter queue (`wager-transactions-dlq.fifo`) for messages exceeding the attempt limit. |
| FIFO queue | SQS queue with ordering/dedup by `MessageGroupId` — an optimization only, never the consistency guarantee. |
| IaC | Infrastructure as Code — version-controlled infrastructure definitions; local only today (`docker-compose.yml`), no cloud IaC yet. |
| IdP | Identity Provider (OIDC) used for HTTP API authentication — **Keycloak** (decided 2026-10-06; realm + guards implemented Phase 8, plan T043/T044; spec §2). |
| OIDC | OpenID Connect — protocol layered on OAuth 2.0 for identity. |
| ADR | Architecture Decision Record, stored in [decisions/](decisions/). |
| Canonical JSON | Key-sorted JSON used to compute `payloadHash`; transport metadata excluded. |
| ISO-4217 | Currency code standard used by `Money.currency` (e.g. `BRL`). |
| Lock-conflict metric | `wageringLockConflictsTotal` counter incremented when `findByIdForUpdate` wait exceeds 50ms (Phase 5, T033); exported by `GET /metrics` since Phase 8 (T046). |
| Transaction metrics | `wageringTxTotal{processed,rejected,pendingReference}` counters and `wageringProcessingSeconds` histogram recorded at transaction completion (Phase 5, T033); exported by `GET /metrics` since Phase 8 (T046). |

## Naming Conventions

- **Events**: PascalCase `eventType` on the concrete `IntegrationEvent` subclass
  (e.g. `WalletBalanceChanged`), with `version` on the type — never a loose string.
- **Enums**: SCREAMING_SNAKE values behind PascalCase members
  (`WagerTransactionKind.Bet = "BET"`).
- **Idempotency key**: required `Idempotency-Key` header; spec §9 recommends the value `{providerId}:{externalTransactionId}`.
- **Queues**: `wager-transactions.fifo` / `wager-transactions-dlq.fifo`.
- **Health endpoints**: `/health/live`, `/health/ready` (readiness body `{postgres, sqs}`).
- **Metrics endpoint**: `GET /metrics` (Prometheus text, `@Public()`).
- **Correlation header**: `x-correlation-id` (validated `/^[A-Za-z0-9._-]{1,128}$/`, echoed; generated when absent/invalid).
- **Docs files**: kebab-case; one file per module/feature/ADR in its `docs/` subfolder.
- **Disambiguation (overloaded words)**:
  - **Transaction** — always `WagerTransaction` (business op); SQL transactions are
    "database transaction"/"commit".
  - **Rollback** — `ROLLBACK` is a business reversal, not an SQL rollback.
  - **Credit/Debit** — ledger directions relative to the wallet, not accounting
    periods.
  - **Provider** — the external game provider (`providerId`), not a software module.
  - **Wallet vs. balance** — wallet is the aggregate; balance is its materialized
    value that must match the ledger.
  - **Event** — integration events (outbox) only; domain methods do not emit
    pre-commit events.

## Terms Applied In

- Architecture and invariants: [architecture.md](architecture.md)
- Contracts and events: [integrations.md](integrations.md)
- Operations: [runbooks/](runbooks/README.md)
