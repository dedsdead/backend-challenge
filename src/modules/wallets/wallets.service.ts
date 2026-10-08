import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Wallet } from '../../domain/wallet/wallet';
import { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { Money, MoneyProps } from '../../domain/money/money';
import { LedgerDirection, WagerTransactionKind } from '../../domain/enums';
import { NotFoundError, WalletExistsError } from '../../domain/errors';
import type {
  LedgerCursor,
  LedgerPage,
} from '../../database/repositories/interfaces';
import {
  MikroOrmWalletRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerEntryRepository,
  MikroOrmOutboxMessageRepository,
} from '../../database/repositories';
import { isUniqueViolation } from '../../database/repositories/unique-violation';
import { WalletBalanceChanged } from '../../events/wallet-balance-changed.event';
import { payloadHash } from '../../common/idempotency/payload-hash';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

@Injectable()
export class WalletsService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async create(cmd: CreateWalletCommand): Promise<Wallet> {
    const initialBalance = Money.from(cmd.initialBalance);
    return this.em.transactional(async (tx) => {
      const wallets = new MikroOrmWalletRepository(tx);

      const wallet = Wallet.open({
        id: crypto.randomUUID(),
        playerId: cmd.playerId,
        initialBalance,
      });
      try {
        await wallets.save(wallet);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw this.exists(cmd.playerId, initialBalance.currency);
        }
        throw error;
      }

      if (!initialBalance.isZero()) {
        await this.openWallet(tx, wallet, initialBalance);
      }
      return wallet;
    });
  }

  private exists(playerId: string, currency: string): WalletExistsError {
    return new WalletExistsError(`Wallet already exists for player ${playerId} and currency ${currency}`);
  }

  async get(walletId: string): Promise<Wallet> {
    return this.em.transactional(async (tx) => {
      const wallet = await new MikroOrmWalletRepository(tx).findById(walletId);
      if (!wallet) throw new NotFoundError('Wallet not found');
      return wallet;
    });
  }

  async listLedger(
    walletId: string,
    cursor?: LedgerCursor,
    limit = 50,
  ): Promise<LedgerPage> {
    return this.em.transactional(async (tx) => {
      const wallet = await new MikroOrmWalletRepository(tx).findById(walletId);
      if (!wallet) throw new NotFoundError('Wallet not found');
      return new MikroOrmWalletLedgerEntryRepository(tx).pageByCursor(
        walletId,
        cursor ?? null,
        limit,
      );
    });
  }

  /** Opening balance: OPENING transaction + CREDIT ledger entry + outbox event,
   * same SQL transaction as the wallet row (spec §9). */
  private async openWallet(
    tx: EntityManager,
    wallet: Wallet,
    initialBalance: Money,
  ): Promise<void> {
    const now = new Date();
    const opening = WagerTransaction.create({
      id: crypto.randomUUID(),
      providerId: 'internal',
      externalTransactionId: `opening-${wallet.id}`,
      idempotencyKey: `opening:${wallet.id}`,
      payloadHash: payloadHash({
        kind: WagerTransactionKind.Opening,
        walletId: wallet.id,
        initialBalance: initialBalance.toJSON(),
      }),
      walletId: wallet.id,
      playerId: wallet.playerId,
      // NOT NULL workaround: round_id/game_id columns are required (migration 001)
      // but OPENING has no real round/game. Use wallet.id as a deterministic sentinel.
      // Documented in docs/modules/wallets.md. Revisit with migration 002 (T039).
      roundId: wallet.id,
      gameId: wallet.id,
      kind: WagerTransactionKind.Opening,
      money: initialBalance,
      createdAt: now,
      isInternal: true,
    });
    opening.markProcessed(undefined, now);
    opening.setResultBalance(initialBalance);
    await new MikroOrmWagerTransactionRepository(tx).save(opening);

    const zero = Money.zero(initialBalance.currency);
    const entry = WalletLedgerEntry.create({
      walletId: wallet.id,
      transactionId: opening.id,
      direction: opening.ledgerDirectionFor(),
      money: initialBalance,
      balanceBefore: zero,
      balanceAfter: initialBalance,
      createdAt: now,
    });
    await new MikroOrmWalletLedgerEntryRepository(tx).save(entry);

    const event = WalletBalanceChanged.from({
      eventId: crypto.randomUUID(),
      aggregateId: wallet.id,
      correlationId: opening.id,
      occurredAt: now,
      walletId: wallet.id,
      transactionId: opening.id,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: zero,
      balanceAfter: initialBalance,
      walletVersion: wallet.version,
    });
    await new MikroOrmOutboxMessageRepository(tx).save(
      OutboxMessage.enqueue({
        eventId: event.eventId,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.data as Record<string, unknown>,
        occurredAt: event.occurredAt,
      }),
    );
  }
}
