import type { EntityManager } from '@mikro-orm/core';
import { Wallet } from '../../domain/wallet/wallet';
import { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { InboxMessage } from '../../domain/inbox/inbox-message';
import { OutboxMessage } from '../../domain/outbox/outbox-message';

export interface WalletRepository {
  findById(id: string): Promise<Wallet | null>;
  /** Pessimistic row lock (`FOR UPDATE`). Caller must be inside `em.transactional()`. */
  findByIdForUpdate(id: string): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  findByProviderAndExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
  findPendingReference(limit?: number): Promise<WagerTransaction[]>;
  /** PENDING_REFERENCE rows whose `referenceNextAttemptAt` is null (never scheduled) or `<= at`, oldest attempt first. */
  findPendingReferenceDue(at: Date, limit?: number): Promise<WagerTransaction[]>;
  save(tx: WagerTransaction): Promise<void>;
}

/** Keyset cursor for ledger paging; pairs with `pageByCursor`. */
export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  /** Cursor for the next (older) page, or null when the last page was reached. */
  nextCursor: LedgerCursor | null;
}

export interface WalletLedgerEntryRepository {
  findByTransactionId(transactionId: string): Promise<WalletLedgerEntry[]>;
  findByWalletId(walletId: string, limit?: number): Promise<WalletLedgerEntry[]>;
  /** Newest-first keyset page on `(created_at, id)` descending; parameterized, no OFFSET. */
  pageByCursor(walletId: string, cursor?: LedgerCursor | null, limit?: number): Promise<LedgerPage>;
  /** Reconstructs the wallet balance from the ledger as a decimal string (`CREDIT` minus `DEBIT`). */
  sumByWallet(walletId: string): Promise<string>;
  save(entry: WalletLedgerEntry): Promise<void>;
}

export interface InboxMessageRepository {
  findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  /** Inserts a new message; a duplicate (consumerName, messageId) surfaces as a unique violation — detect it with isUniqueViolation(). */
  save(message: InboxMessage): Promise<void>;
  /** Persists processed_at for an already-stored message. */
  markProcessed(consumerName: string, messageId: string, at: Date): Promise<void>;
}

export interface OutboxMessageRepository {
  findPending(limit?: number): Promise<OutboxMessage[]>;
  findDue(now: Date, limit?: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
  /** Raw `SELECT ... FOR UPDATE SKIP LOCKED` over due, unpublished rows. `em` must be inside a transaction; throws otherwise (locks die with the transaction). */
  claimDueBatch(em: EntityManager, limit?: number): Promise<OutboxMessage[]>;
  /** Marks published and persists via the caller's `em` (same transaction as claimDueBatch). */
  markPublished(em: EntityManager, message: OutboxMessage, at: Date): Promise<void>;
  /** Applies the domain backoff schedule (`attempts++`) and persists via the caller's `em`. */
  scheduleRetry(em: EntityManager, message: OutboxMessage, now: Date): Promise<void>;
}
