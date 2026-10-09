import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { MikroOrmWagerTransactionRepository, MikroOrmWalletRepository, MikroOrmWalletLedgerEntryRepository, MikroOrmOutboxMessageRepository } from '../database/repositories';
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from '../domain/enums';
import { FailureCode } from '../domain/failure-codes';
import { Money } from '../domain/money/money';
import { WagerTransaction } from '../domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../domain/outbox/outbox-message';
import { WagerTransactionProcessed } from '../events/wager-transaction-processed.event';
import { WagerTransactionRejected } from '../events/wager-transaction-rejected.event';
import { WalletBalanceChanged } from '../events/wallet-balance-changed.event';

const MAX_REFERENCE_ATTEMPTS = 10;
const REFERENCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 30 * 60; // 30 minutes

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private readonly batchSize = 50;
  private readonly pollIntervalMs = 5000;
  private readonly jitterMs = 1000;
  private isRunning = false;
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly em: EntityManager,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED') === true) {
      await this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log('Starting pending reference worker');
    this.pollLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private pollLoop(): void {
    if (!this.isRunning) return;
    const jitter = Math.random() * this.jitterMs;
    this.timeoutId = setTimeout(() => {
      if (this.isRunning) this.processBatch().finally(() => this.pollLoop());
    }, this.pollIntervalMs + Math.random() * this.jitterMs);
  }

  async processBatch(): Promise<void> {
    const em = this.em.fork();
    try {
      await em.transactional(async (tx) => {
        const transactions = new MikroOrmWagerTransactionRepository(tx);
        const pendingRefs = await transactions.findPendingReferenceDue(new Date(), this.batchSize);
        
        if (pendingRefs.length === 0) return;

        this.logger.debug(`Processing ${pendingRefs.length} pending reference transactions`);

        for (const pendingTx of pendingRefs) {
          await this.processPendingReference(tx, pendingTx);
        }
      });
    } catch (error) {
      this.logger.error('Error processing pending reference batch', error);
    }
  }

  private async processPendingReference(em: EntityManager, pendingTx: WagerTransaction): Promise<void> {
    const transactions = new MikroOrmWagerTransactionRepository(em);
    const wallets = new MikroOrmWalletRepository(em);
    const ledger = new MikroOrmWalletLedgerEntryRepository(em);
    const outbox = new MikroOrmOutboxMessageRepository(em);

    const now = new Date();
    
    // Check if max attempts exceeded or TTL expired
    const createdAt = (pendingTx as any).createdAt;
    const age = now.getTime() - createdAt.getTime();
    const attempts = (pendingTx as any).referenceAttempts ?? 0;

    if (attempts >= MAX_REFERENCE_ATTEMPTS || age > REFERENCE_TTL_MS) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceNotFound, now);
      return;
    }

    // Try to find the reference transaction
    const referenceExternal = pendingTx.referenceExternalTransactionId;
    if (!referenceExternal) {
      // Should not happen as requiresReference() validates this
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceNotFound, now);
      return;
    }

    this.logger.debug(`Looking up reference: providerId=${pendingTx.providerId}, referenceExternal=${referenceExternal}`);
    const reference = await transactions.findByProviderAndExternal(
      pendingTx.providerId,
      referenceExternal,
    );

    if (!reference) {
      // Reference not found yet, schedule retry
      await this.scheduleRetry(em, pendingTx, now);
      return;
    }

    // Validate reference
    if (
      reference.providerId !== pendingTx.providerId ||
      reference.playerId !== pendingTx.playerId ||
      reference.walletId !== pendingTx.walletId ||
      reference.money.currency !== pendingTx.money.currency ||
      reference.roundId !== pendingTx.roundId
    ) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceMismatch, now);
      return;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceNotProcessed, now);
      return;
    }

    const allowedReferenceKinds: WagerTransactionKind[] =
      pendingTx.kind === WagerTransactionKind.Refund
        ? [WagerTransactionKind.Bet]
        : [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund];

    if (!allowedReferenceKinds.includes(reference.kind)) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceInvalidKind, now);
      return;
    }

    if (!reference.money.equals(pendingTx.money)) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceAmountMismatch, now);
      return;
    }

    // Check if same-kind reversal already applied
    const appliedReversal = await transactions.findAppliedReversal(reference.id, pendingTx.kind);
    if (appliedReversal) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReferenceAlreadyReversed, now);
      return;
    }

    // Reference is valid - apply the transaction
    this.logger.debug('Reference validation passed, processing transaction', {
      transactionId: pendingTx.id,
      walletId: pendingTx.walletId,
      providerId: pendingTx.providerId,
    });
    const wallet = await wallets.findByIdForUpdate(pendingTx.walletId);
    if (!wallet) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.WalletNotFound, now);
      return;
    }

    if (wallet.balance.currency !== pendingTx.money.currency) {
      await this.rejectWithFailureCode(em, pendingTx, FailureCode.CurrencyMismatch, now);
      return;
    }

    let movement: { direction: LedgerDirection; money: Money; balanceBefore: Money; balanceAfter: Money } | undefined;
    let nextWallet = wallet;

    if (pendingTx.affectsBalance()) {
      const direction = pendingTx.ledgerDirectionFor(reference);
      let applied;
      try {
        applied = direction === LedgerDirection.Credit
          ? wallet.credit(pendingTx.money, now)
          : wallet.debit(pendingTx.money, now);
      } catch (error) {
        if (error instanceof Error && error.name === 'InsufficientFundsError') {
          await this.rejectWithFailureCode(em, pendingTx, FailureCode.ReversalExceedsBalance, now);
          return;
        }
        throw error;
      }
      movement = applied.movement;
      nextWallet = applied.wallet;
      await wallets.save(nextWallet);

      await ledger.save(
        WalletLedgerEntry.create({
          walletId: wallet.id,
          transactionId: pendingTx.id,
          direction,
          money: pendingTx.money,
          balanceBefore: movement.balanceBefore,
          balanceAfter: movement.balanceAfter,
          createdAt: now,
        })
      );
    }

    const observedBalance = movement ? movement.balanceAfter : wallet.balance;
    pendingTx.markProcessed(reference.id, now);
    pendingTx.setResultBalance(observedBalance);
    await transactions.save(pendingTx);

    this.logger.log('Pending reference resolved', {
      transactionId: pendingTx.id,
      walletId: pendingTx.walletId,
      providerId: pendingTx.providerId,
    });

    // Emit events
    const processed = WagerTransactionProcessed.from({
      eventId: crypto.randomUUID(),
      aggregateId: pendingTx.id,
      correlationId: pendingTx.id,
      occurredAt: now,
      transactionId: pendingTx.id,
      walletId: wallet.id,
      kind: pendingTx.kind,
      money: pendingTx.money,
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
      })
    );

    if (movement) {
      const changed = WalletBalanceChanged.from({
        eventId: crypto.randomUUID(),
        aggregateId: wallet.id,
        correlationId: pendingTx.id,
        occurredAt: now,
        walletId: wallet.id,
        transactionId: pendingTx.id,
        direction: movement.direction,
        money: pendingTx.money,
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
        })
      );
    }
  }

  private async rejectWithFailureCode(
    em: EntityManager,
    pendingTx: WagerTransaction,
    failureCode: FailureCode,
    at: Date,
  ): Promise<void> {
    const transactions = new MikroOrmWagerTransactionRepository(em);
    const outbox = new MikroOrmOutboxMessageRepository(em);

    pendingTx.reject(failureCode);
    pendingTx.setResultBalance((pendingTx as any).resultBalance ?? pendingTx.money);
    await transactions.save(pendingTx);

    const rejected = WagerTransactionRejected.from({
      eventId: crypto.randomUUID(),
      aggregateId: pendingTx.id,
      correlationId: pendingTx.id,
      occurredAt: at,
      transactionId: pendingTx.id,
      walletId: pendingTx.walletId,
      kind: pendingTx.kind,
      money: pendingTx.money,
      failureCode,
    });
    await outbox.save(
      OutboxMessage.enqueue({
        eventId: rejected.eventId,
        aggregateId: rejected.aggregateId,
        eventType: rejected.eventType,
        payload: rejected.data as Record<string, unknown>,
        occurredAt: rejected.occurredAt,
      })
    );
  }

  private async scheduleRetry(
    em: EntityManager,
    pendingTx: WagerTransaction,
    now: Date,
  ): Promise<void> {
    const transactions = new MikroOrmWagerTransactionRepository(em);

    // Increment attempts and calculate next attempt time with exponential backoff
    const currentAttempts = (pendingTx as any).referenceAttempts ?? 0;
    const nextAttempts = currentAttempts + 1;
    const delaySeconds = Math.min(Math.pow(2, nextAttempts) * BASE_BACKOFF_SECONDS, MAX_BACKOFF_SECONDS);
    const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);

    // Update the entity directly via raw query since these fields aren't in domain
    await (em as any).execute(
      `UPDATE wager_transaction 
       SET reference_attempts = ?, reference_next_attempt_at = ?
       WHERE id = ?`,
      [nextAttempts, nextAttemptAt, pendingTx.id]
    );
  }
}