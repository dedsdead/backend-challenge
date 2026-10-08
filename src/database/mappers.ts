import { Money } from '../domain/money/money';
import { Wallet } from '../domain/wallet/wallet';
import { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import { InboxMessage } from '../domain/inbox/inbox-message';
import { OutboxMessage } from '../domain/outbox/outbox-message';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../domain/enums';
import type { FailureCode } from '../domain/failure-codes';

export interface WalletRow {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  moneyAmount: string;
  moneyCurrency: string;
  referenceExternalTransactionId: string | null;
  status: string;
  referenceTransactionId: string | null;
  failureCode: string | null;
  processedAt: Date | null;
  resultBalanceAmount: string | null;
  resultBalanceCurrency: string | null;
  referenceAttempts: number;
  referenceNextAttemptAt: Date | null;
  createdAt: Date;
}

export interface WalletLedgerEntryRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: string;
  moneyAmount: string;
  moneyCurrency: string;
  balanceBeforeAmount: string;
  balanceBeforeCurrency: string;
  balanceAfterAmount: string;
  balanceAfterCurrency: string;
  createdAt: Date;
}

export interface InboxMessageRow {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface OutboxMessageRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}

export function walletToEntity(wallet: Wallet): WalletRow {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balanceAmount: wallet.balance.amount,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function walletFromEntity(row: WalletRow): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    currency: row.currency,
    balance: row.balanceAmount,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function wagerTransactionToEntity(tx: WagerTransaction): WagerTransactionRow {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    idempotencyKey: tx.idempotencyKey,
    payloadHash: tx.payloadHash,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    moneyAmount: tx.money.amount,
    moneyCurrency: tx.money.currency,
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    status: tx.status,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    failureCode: tx.failureCode ?? null,
    processedAt: tx.processedAt ?? null,
    resultBalanceAmount: tx.resultBalance?.amount ?? null,
    resultBalanceCurrency: tx.resultBalance?.currency ?? null,
    referenceAttempts: 0,
    referenceNextAttemptAt: null,
    createdAt: tx.createdAt,
  };
}

export function wagerTransactionFromEntity(row: WagerTransactionRow): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.providerId,
    externalTransactionId: row.externalTransactionId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    walletId: row.walletId,
    playerId: row.playerId,
    roundId: row.roundId,
    gameId: row.gameId,
    kind: row.kind as WagerTransactionKind,
    money: row.moneyAmount,
    currency: row.moneyCurrency,
    referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
    status: row.status as WagerTransactionStatus,
    referenceTransactionId: row.referenceTransactionId ?? undefined,
    failureCode: (row.failureCode as FailureCode) ?? undefined,
    processedAt: row.processedAt ?? undefined,
    createdAt: row.createdAt,
    resultBalance: row.resultBalanceAmount ?? undefined,
    resultBalanceCurrency: row.resultBalanceCurrency ?? undefined,
  });
}

export function ledgerEntryToEntity(entry: WalletLedgerEntry): WalletLedgerEntryRow {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    moneyAmount: entry.money.amount,
    moneyCurrency: entry.money.currency,
    balanceBeforeAmount: entry.balanceBefore.amount,
    balanceBeforeCurrency: entry.balanceBefore.currency,
    balanceAfterAmount: entry.balanceAfter.amount,
    balanceAfterCurrency: entry.balanceAfter.currency,
    createdAt: entry.createdAt,
  };
}

export function ledgerEntryFromEntity(row: WalletLedgerEntryRow): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: row.id,
    walletId: row.walletId,
    transactionId: row.transactionId,
    direction: row.direction as LedgerDirection,
    money: row.moneyAmount,
    currency: row.moneyCurrency,
    balanceBefore: row.balanceBeforeAmount,
    balanceBeforeCurrency: row.balanceBeforeCurrency,
    balanceAfter: row.balanceAfterAmount,
    balanceAfterCurrency: row.balanceAfterCurrency,
    createdAt: row.createdAt,
  });
}

export function inboxMessageToEntity(message: InboxMessage): Omit<InboxMessageRow, 'id'> {
  return {
    messageId: message.messageId,
    consumerName: message.consumerName,
    payloadHash: message.payloadHash,
    receivedAt: message.receivedAt,
    processedAt: message.processedAt ?? null,
  };
}

export function inboxMessageFromEntity(row: InboxMessageRow): InboxMessage {
  return InboxMessage.rehydrate({
    messageId: row.messageId,
    consumerName: row.consumerName,
    payloadHash: row.payloadHash,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? undefined,
  });
}

export function outboxMessageToEntity(message: OutboxMessage): OutboxMessageRow {
  return {
    id: message.id,
    aggregateId: message.aggregateId,
    eventType: message.eventType,
    payload: message.payload,
    occurredAt: message.occurredAt,
    attempts: message.attempts,
    nextAttemptAt: message.nextAttemptAt ?? null,
    publishedAt: message.publishedAt ?? null,
  };
}

export function outboxMessageFromEntity(row: OutboxMessageRow): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: row.id,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
  });
}