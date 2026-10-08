import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import { LedgerMovement } from '../../domain/wallet/wallet';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { Money, MoneyProps } from '../../domain/money/money';
import { InboxMessage } from '../../domain/inbox/inbox-message';
import {
  LedgerDirection,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/enums';
import { FailureCode } from '../../domain/failure-codes';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  ReferenceResolutionError,
  ValidationError,
} from '../../domain/errors';
import {
  MikroOrmWalletRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerEntryRepository,
  MikroOrmOutboxMessageRepository,
  MikroOrmInboxMessageRepository,
} from '../../database/repositories';
import { isUniqueViolation } from '../../database/repositories/unique-violation';
import { payloadHash } from '../../common/idempotency/payload-hash';
import { WagerTransactionProcessed } from '../../events/wager-transaction-processed.event';
import { metrics } from '../../common/metrics/metrics';
import { WagerTransactionRejected } from '../../events/wager-transaction-rejected.event';
import { WagerTransactionPendingReference } from '../../events/wager-transaction-pending-reference.event';
import { WalletBalanceChanged } from '../../events/wallet-balance-changed.event';

/** Lock-conflict threshold from glossary: "Lock conflict | A `findByIdForUpdate` wait exceeding 50ms" */
const LOCK_CONFLICT_THRESHOLD_MS = 50;

export type SubmitIngress =
  | { kind: 'http' }
  | { kind: 'sqs'; messageId: string; consumerName: string };

export interface SubmitTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  idempotencyKey: string;
  ingress: SubmitIngress;
}

export interface SubmitTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance?: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

@Injectable()
export class SubmitTransactionUseCase {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async execute(cmd: SubmitTransactionCommand): Promise<SubmitTransactionResult> {
    try {
      return await this.runInTx(cmd);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // G1 race: a concurrent submit committed between our lookup and insert.
      // The aborted transaction rolls back all effects; a fresh transaction
      // re-resolves through the idempotency/reference lookups.
      try {
        return await this.runInTx(cmd);
      } catch (retryError) {
        if (!isUniqueViolation(retryError)) throw retryError;
        // The retry lost the race again (or hit a different unique constraint,
        // e.g. a concurrent reversal of the same reference): classify the
        // collision with read-only lookups so it answers 409/422 instead of 500.
        return this.resolveDuplicate(cmd, retryError);
      }
    }
  }

  /** Classify a unique-constraint collision after the retry also failed.
   * Every path is read-only — the original violation already rolled back. */
  private async resolveDuplicate(
    cmd: SubmitTransactionCommand,
    error: unknown,
  ): Promise<SubmitTransactionResult> {
    const hash = this.businessHash(cmd);
    return this.em.transactional(async (tx) => {
      const transactions = new MikroOrmWagerTransactionRepository(tx);

      const byKey = await transactions.findByIdempotencyKey(cmd.idempotencyKey);
      if (byKey) {
        if (!byKey.matchesPayload(hash)) {
          throw new IdempotencyConflictError(
            `Idempotency key ${cmd.idempotencyKey} was used with a different payload`,
          );
        }
        return this.replay(byKey);
      }

      const byExternal = await transactions.findByProviderAndExternal(
        cmd.providerId,
        cmd.externalTransactionId,
      );
      if (byExternal) {
        throw new IdempotencyConflictError(
          `${cmd.providerId}:${cmd.externalTransactionId} was already submitted under a different Idempotency-Key`,
        );
      }

      if (cmd.referenceExternalTransactionId) {
        const reference = await transactions.findByProviderAndExternal(
          cmd.providerId,
          cmd.referenceExternalTransactionId,
        );
        const appliedReversal = reference
          ? await transactions.findAppliedReversal(reference.id, cmd.kind)
          : undefined;
        if (appliedReversal) {
          throw new ReferenceResolutionError(
            `Reference already reversed by transaction ${appliedReversal.id}`,
            FailureCode.ReferenceAlreadyReversed,
          );
        }
      }

      throw error;
    });
  }

  private businessHash(cmd: SubmitTransactionCommand): string {
    return payloadHash({
      providerId: cmd.providerId,
      externalTransactionId: cmd.externalTransactionId,
      walletId: cmd.walletId,
      playerId: cmd.playerId,
      roundId: cmd.roundId,
      gameId: cmd.gameId,
      kind: cmd.kind,
      amount: cmd.amount,
      currency: cmd.currency,
      referenceExternalTransactionId: cmd.referenceExternalTransactionId,
    });
  }

  private replay(stored: WagerTransaction): SubmitTransactionResult {
    return {
      transactionId: stored.id,
      status: stored.status,
      balance: stored.resultBalance?.toJSON(),
      idempotentReplay: true,
      failureCode: stored.failureCode,
    };
  }

  private async runInTx(cmd: SubmitTransactionCommand): Promise<SubmitTransactionResult> {
    const hash = this.businessHash(cmd);
    const txStart = Date.now();
    return this.em.transactional(async (tx) => {
      const wallets = new MikroOrmWalletRepository(tx);
      const transactions = new MikroOrmWagerTransactionRepository(tx);
      const ledger = new MikroOrmWalletLedgerEntryRepository(tx);
      const outbox = new MikroOrmOutboxMessageRepository(tx);
      const inbox = new MikroOrmInboxMessageRepository(tx);
      const now = new Date();

      // step 1 — inbox dedup for SQS ingress: a seen message returns the
      // stored outcome with no effects (the consumer acks afterwards).
      if (cmd.ingress.kind === 'sqs') {
        const seen = await inbox.findByConsumerAndMessageId(
          cmd.ingress.consumerName,
          cmd.ingress.messageId,
        );
        if (seen) {
          // Payload hash mismatch → different business payload for same messageId
          if (seen.payloadHash !== hash) {
            throw new IdempotencyConflictError(
              `Inbox message ${cmd.ingress.messageId} already processed with a different payload`,
            );
          }
          const storedForDelivery = await transactions.findByIdempotencyKey(cmd.idempotencyKey);
          if (!storedForDelivery) {
            // Same payload but different idempotency key — treat as conflict
            throw new IdempotencyConflictError(
              `Inbox message ${cmd.ingress.messageId} was processed under a different Idempotency-Key`,
            );
          }
          if (!storedForDelivery.matchesPayload(hash)) {
            throw new IdempotencyConflictError(
              `Idempotency key ${cmd.idempotencyKey} was used with a different payload`,
            );
          }
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), this.replay(storedForDelivery);
        }
        await inbox.save(
          InboxMessage.receive({
            messageId: cmd.ingress.messageId,
            consumerName: cmd.ingress.consumerName,
            payloadHash: hash,
            receivedAt: now,
          }),
        );
      }

      // step 2 — idempotency lookup: replay the stored outcome (success,
      // rejection, or pending) including its original balance snapshot.
      const existing = await transactions.findByIdempotencyKey(cmd.idempotencyKey);
      if (existing) {
        if (!existing.matchesPayload(hash)) {
          throw new IdempotencyConflictError(
            `Idempotency key ${cmd.idempotencyKey} was used with a different payload`,
          );
        }
        return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), this.replay(existing);
      }

      // (providerId, externalTransactionId) is unique: the same external id
      // under a DIFFERENT Idempotency-Key is a conflict (409), not a 500.
      // The same key means this is our own row (a race the insert+retry will
      // resolve as a replay) — do not treat it as a conflict.
      const duplicateExternal = await transactions.findByProviderAndExternal(
        cmd.providerId,
        cmd.externalTransactionId,
      );
      if (duplicateExternal && duplicateExternal.idempotencyKey !== cmd.idempotencyKey) {
        throw new IdempotencyConflictError(
          `${cmd.providerId}:${cmd.externalTransactionId} was already submitted under a different Idempotency-Key`,
        );
      }

      const money = Money.from({ amount: cmd.amount, currency: cmd.currency });
      const wagerTx = WagerTransaction.create({
        id: crypto.randomUUID(),
        providerId: cmd.providerId,
        externalTransactionId: cmd.externalTransactionId,
        idempotencyKey: cmd.idempotencyKey,
        payloadHash: hash,
        walletId: cmd.walletId,
        playerId: cmd.playerId,
        roundId: cmd.roundId,
        gameId: cmd.gameId,
        kind: cmd.kind,
        money,
        referenceExternalTransactionId: cmd.referenceExternalTransactionId,
        createdAt: now,
        isInternal: false,
      });

      // wallet row lock — serializes concurrent submissions per wallet
      const lockStart = Date.now();
      const wallet = await wallets.findByIdForUpdate(cmd.walletId);
      const lockWaitMs = Date.now() - lockStart;
      if (lockWaitMs > LOCK_CONFLICT_THRESHOLD_MS) {
        metrics.wageringLockConflictsTotal.inc();
      }

      const recordTxMetric = (status: WagerTransactionStatus): void => {
        if (status === WagerTransactionStatus.Processed) {
          metrics.wageringTxTotal.processed.inc();
        } else if (status === WagerTransactionStatus.Rejected) {
          metrics.wageringTxTotal.rejected.inc();
        } else if (status === WagerTransactionStatus.PendingReference) {
          metrics.wageringTxTotal.pendingReference.inc();
        }
      };

      const reject = async (
        failureCode: FailureCode,
        observedBalance: Money | undefined,
      ): Promise<SubmitTransactionResult> => {
        wagerTx.reject(failureCode);
        if (observedBalance) wagerTx.setResultBalance(observedBalance);
        await transactions.save(wagerTx);
        const rejected = WagerTransactionRejected.from({
          eventId: crypto.randomUUID(),
          aggregateId: wagerTx.id,
          correlationId: wagerTx.id,
          occurredAt: now,
          transactionId: wagerTx.id,
          walletId: cmd.walletId,
          kind: wagerTx.kind,
          money,
          failureCode,
        });
        await outbox.save(
          OutboxMessage.enqueue({
            eventId: rejected.eventId,
            aggregateId: rejected.aggregateId,
            eventType: rejected.eventType,
            payload: rejected.data as Record<string, unknown>,
            occurredAt: rejected.occurredAt,
          }),
        );
recordTxMetric(wagerTx.status);
    return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), {
        transactionId: wagerTx.id,
        status: wagerTx.status,
        balance: observedBalance?.toJSON(),
        idempotentReplay: false,
        failureCode,
      };
    };

      if (!wallet) {
        return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.WalletNotFound, undefined);
      }
      if (wallet.playerId !== cmd.playerId) {
        return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.WalletNotFound, undefined);
      }
      if (wallet.balance.currency !== money.currency) {
        return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.CurrencyMismatch, wallet.balance);
      }

      // reference resolution for REFUND/ROLLBACK (§7.4)
      let reference: WagerTransaction | undefined;
      if (wagerTx.requiresReference()) {
        // Guarded by WagerTransaction.create above; the local keeps the type
        // narrowing without a cast.
        const referenceExternal = cmd.referenceExternalTransactionId;
        if (!referenceExternal) {
          throw new ValidationError(
            `${wagerTx.kind} requires referenceExternalTransactionId`,
          );
        }
        reference =
          (await transactions.findByProviderAndExternal(cmd.providerId, referenceExternal)) ??
          undefined;
        if (!reference) {
          wagerTx.markPendingReference();
          wagerTx.setResultBalance(wallet.balance);
          await transactions.save(wagerTx);
          const pendingEvent = WagerTransactionPendingReference.from({
            eventId: crypto.randomUUID(),
            aggregateId: wagerTx.id,
            correlationId: wagerTx.id,
            occurredAt: now,
            transactionId: wagerTx.id,
            walletId: wallet.id,
            kind: wagerTx.kind,
            money,
            referenceExternalTransactionId: referenceExternal,
          });
          await outbox.save(
            OutboxMessage.enqueue({
              eventId: pendingEvent.eventId,
              aggregateId: pendingEvent.aggregateId,
              eventType: pendingEvent.eventType,
              payload: pendingEvent.data as Record<string, unknown>,
              occurredAt: pendingEvent.occurredAt,
            }),
          );
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), {
            transactionId: wagerTx.id,
            status: wagerTx.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
        recordTxMetric(wagerTx.status);
        if (
          reference.providerId !== cmd.providerId ||
          reference.playerId !== cmd.playerId ||
          reference.walletId !== cmd.walletId ||
          reference.money.currency !== money.currency ||
          reference.roundId !== cmd.roundId
        ) {
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.ReferenceMismatch, wallet.balance);
        }
        if (reference.status !== WagerTransactionStatus.Processed) {
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.ReferenceNotProcessed, wallet.balance);
        }
        const allowedReferenceKinds: WagerTransactionKind[] =
          wagerTx.kind === WagerTransactionKind.Refund
            ? [WagerTransactionKind.Bet]
            : [
                WagerTransactionKind.Bet,
                WagerTransactionKind.Win,
                WagerTransactionKind.Refund,
              ];
        if (!allowedReferenceKinds.includes(reference.kind)) {
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.ReferenceInvalidKind, wallet.balance);
        }
        if (!reference.money.equals(money)) {
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.ReferenceAmountMismatch, wallet.balance);
        }
        const appliedReversal = await transactions.findAppliedReversal(
          reference.id,
          wagerTx.kind,
        );
        if (appliedReversal) {
          return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(FailureCode.ReferenceAlreadyReversed, wallet.balance);
        }
      }

      let movement: LedgerMovement | undefined;
      let nextWallet = wallet;
      if (wagerTx.affectsBalance()) {
        const direction = wagerTx.ledgerDirectionFor(reference);
        let applied;
        try {
          applied =
            direction === LedgerDirection.Credit
              ? wallet.credit(money, now)
              : wallet.debit(money, now);
        } catch (error) {
          if (error instanceof InsufficientFundsError) {
            return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), reject(
              wagerTx.requiresReference()
                ? FailureCode.ReversalExceedsBalance
                : FailureCode.InsufficientFunds,
              wallet.balance,
            );
          }
          throw error;
        }
        movement = applied.movement;
        nextWallet = applied.wallet;
        await wallets.save(nextWallet);
        await ledger.save(
          WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId: wagerTx.id,
            direction,
            money,
            balanceBefore: movement.balanceBefore,
            balanceAfter: movement.balanceAfter,
            createdAt: now,
          }),
        );
      }

      const observedBalance = movement ? movement.balanceAfter : wallet.balance;
      wagerTx.markProcessed(reference?.id, now);
      wagerTx.setResultBalance(observedBalance);
      await transactions.save(wagerTx);

      const processed = WagerTransactionProcessed.from({
        eventId: crypto.randomUUID(),
        aggregateId: wagerTx.id,
        correlationId: wagerTx.id,
        occurredAt: now,
        transactionId: wagerTx.id,
        walletId: wallet.id,
        kind: wagerTx.kind,
        money,
        balanceBefore: movement ? movement.balanceBefore : wallet.balance,
        balanceAfter: observedBalance,
        walletVersion: nextWallet.version,
      });
      await outbox.save(
        OutboxMessage.enqueue({
          eventId: processed.eventId,
          aggregateId: processed.aggregateId,
          eventType: processed.eventType,
          payload: processed.data as Record<string, unknown>,
          occurredAt: processed.occurredAt,
        }),
      );

      if (movement) {
        const changed = WalletBalanceChanged.from({
          eventId: crypto.randomUUID(),
          aggregateId: wallet.id,
          correlationId: wagerTx.id,
          occurredAt: now,
          walletId: wallet.id,
          transactionId: wagerTx.id,
          direction: movement.direction,
          money,
          balanceBefore: movement.balanceBefore,
          balanceAfter: movement.balanceAfter,
          walletVersion: nextWallet.version,
        });
        await outbox.save(
          OutboxMessage.enqueue({
            eventId: changed.eventId,
            aggregateId: changed.aggregateId,
            eventType: changed.eventType,
            payload: changed.data as Record<string, unknown>,
            occurredAt: changed.occurredAt,
          }),
        );
      }

      recordTxMetric(wagerTx.status);
      return metrics.wageringProcessingSeconds.observe((Date.now() - txStart) / 1000), {
        transactionId: wagerTx.id,
        status: wagerTx.status,
        balance: observedBalance.toJSON(),
        idempotentReplay: false,
      };
    });
  }
}
