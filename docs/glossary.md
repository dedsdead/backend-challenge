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
| `PENDING_REFERENCE` | Waiting for the referenced transaction; reprocessed by scheduled worker with backoff. Columns `reference_attempts` / `reference_next_attempt_at` exist since migration 001; the worker itself is planned (Phase 7). | spec §7.1 |
| `PROCESSED` / `REJECTED` / `FAILED` | Terminal states — no further transitions; attempting one is a programming error. | spec §6.3 |
| `failureCode` | Stable, machine-readable reason for rejection/failure; taxonomy defined by the implementation. | spec §7.2 |
| `code` | Stable HTTP error-class identifier in API response bodies (e.g. `UNAUTHORIZED`, `ROLE_FORBIDDEN`, `VALIDATION_ERROR`) — distinct from `failureCode`, which is domain-level. | plan §4 |
| `transact:write` / `transact:read` | Keycloak roles: write required for POST endpoints, read for GET. | plan T043/T044 |
| Idempotency conflict | Same `Idempotency-Key` with a different `payloadHash` — distinct from a replay. | spec §9 |

## Technical Terms and Acronyms

| Term | Definition |
|---|---|
| Inbox | Persistent dedup record per `(consumerName, messageId)`; prevents duplicate effects from redelivery. `inbox_message` table + repository exist (Phase 3); the SQS consumer that writes them is planned (Phase 6). |
| Outbox | Event rows written in the same SQL transaction as the financial change; a worker publishes them post-commit. `outbox_message` table + repositories (incl. `claimDueBatch`) exist (Phase 3); the use case that writes rows and the publisher worker are planned (Phases 4/7). |
| At-least-once | Delivery guarantee assumed everywhere: duplicates are normal, effects must be idempotent. |
| Lost update | Concurrent writes silently overwriting each other; prevented by the chosen concurrency strategy per `walletId`. |
| Optimistic locking | Conflict detection via `version` increment with bounded retry. |
| Pessimistic locking | Row-level lock held for the duration of the balance change. Implemented as `WalletRepository.findByIdForUpdate` (`LockMode.PESSIMISTIC_WRITE` in `src/database/repositories/mikro-orm.repositories.ts`); no use case calls it yet (Phases 4–5). |
| Keyset cursor (`LedgerCursor` / `LedgerPage`) | Newest-first pagination on `(created_at, id)` via `WalletLedgerEntryRepository.pageByCursor` — parameterized, no `OFFSET`; `nextCursor` is `null` on the last page. |
| DLQ | Dead-letter queue (`wager-transactions-dlq.fifo`) for messages exceeding the attempt limit. |
| FIFO queue | SQS queue with ordering/dedup by `MessageGroupId` — an optimization only, never the consistency guarantee. |
| IaC | Infrastructure as Code — version-controlled infrastructure definitions; local only today (`docker-compose.yml`), no cloud IaC yet. |
| IdP | Identity Provider (OIDC) used for HTTP API authentication — **Keycloak** (decided 2026-10-06, plan T043; spec §2). |
| OIDC | OpenID Connect — protocol layered on OAuth 2.0 for identity. |
| ADR | Architecture Decision Record, stored in [decisions/](decisions/). |
| Canonical JSON | Key-sorted JSON used to compute `payloadHash`; transport metadata excluded. |
| ISO-4217 | Currency code standard used by `Money.currency` (e.g. `BRL`). |

## Naming Conventions

- **Events**: PascalCase `eventType` on the concrete `IntegrationEvent` subclass
  (e.g. `WalletBalanceChanged`), with `version` on the type — never a loose string.
- **Enums**: SCREAMING_SNAKE values behind PascalCase members
  (`WagerTransactionKind.Bet = "BET"`).
- **Idempotency key**: `{providerId}:{externalTransactionId}` (spec §9 default).
- **Queues**: `wager-transactions.fifo` / `wager-transactions-dlq.fifo`.
- **Health endpoints**: `/health/live`, `/health/ready`.
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
