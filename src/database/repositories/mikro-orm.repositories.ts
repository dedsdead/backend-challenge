import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery, LockMode } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/sql';
import { WalletEntity } from '../entities/wallet.entity';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';
import { Wallet } from '../../domain/wallet/wallet';
import { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { InboxMessage } from '../../domain/inbox/inbox-message';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import {
  WalletRow,
  WagerTransactionRow,
  WalletLedgerEntryRow,
  InboxMessageRow,
  OutboxMessageRow,
  walletToEntity,
  walletFromEntity,
  wagerTransactionToEntity,
  wagerTransactionFromEntity,
  ledgerEntryToEntity,
  ledgerEntryFromEntity,
  inboxMessageToEntity,
  inboxMessageFromEntity,
  outboxMessageToEntity,
  outboxMessageFromEntity,
} from '../mappers';
import {
  WalletRepository,
  WagerTransactionRepository,
  WalletLedgerEntryRepository,
  InboxMessageRepository,
  OutboxMessageRepository,
  LedgerCursor,
  LedgerPage,
} from './interfaces';
import { WagerTransactionKind } from '../../domain/enums';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** em.execute() binds `?` placeholders via MikroORM's query formatting
 * (`$1` style is dropped by the driver → PG 42P02). Guards below stay as
 * defense-in-depth on top of parameter binding. */
function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${name} must be a uuid`);
  }
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

@Injectable()
export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntity, { id } as FilterQuery<any>);
    return row ? walletFromEntity(row as unknown as WalletRow) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    // FOR UPDATE — MikroORM raises outside a transaction (checkLockRequirements).
    const row = await this.em.findOne(
      WalletEntity,
      { id } as FilterQuery<any>,
      { lockMode: LockMode.PESSIMISTIC_WRITE } as never,
    );
    return row ? walletFromEntity(row as unknown as WalletRow) : null;
  }

  async findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntity, { playerId, currency } as FilterQuery<any>);
    return row ? walletFromEntity(row as unknown as WalletRow) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    const data = walletToEntity(wallet);
    const existing = await this.em.findOne(WalletEntity, { id: wallet.id } as FilterQuery<any>);
    if (existing) {
      // version is managed by MikroORM's optimistic lock (version: true);
      // the loaded original version drives the WHERE guard and the increment.
      const { version: _version, ...changes } = data;
      this.em.assign(existing, changes as any);
    } else {
      this.em.create(WalletEntity, data as any);
    }
    await this.em.flush();
  }
}

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, { id } as FilterQuery<any>);
    return row ? wagerTransactionFromEntity(row as unknown as WagerTransactionRow) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, { idempotencyKey } as FilterQuery<any>);
    return row ? wagerTransactionFromEntity(row as unknown as WagerTransactionRow) : null;
  }

  async findByProviderAndExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId } as FilterQuery<any>);
    return row ? wagerTransactionFromEntity(row as unknown as WagerTransactionRow) : null;
  }

  async findAppliedReversal(referenceTransactionId: string, kind: WagerTransactionKind): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: 'PROCESSED',
    } as FilterQuery<any>);
    return row ? wagerTransactionFromEntity(row as unknown as WagerTransactionRow) : null;
  }

  async findPendingReference(limit = 100): Promise<WagerTransaction[]> {
    const rows = await this.em.find(
      WagerTransactionEntity,
      { status: 'PENDING_REFERENCE' } as FilterQuery<any>,
      { orderBy: { createdAt: 'ASC' }, limit } as any,
    );
    return rows.map((r) => wagerTransactionFromEntity(r as unknown as WagerTransactionRow));
  }

  async findPendingReferenceDue(at: Date, limit = 100): Promise<WagerTransaction[]> {
    const rows = await this.em.find(
      WagerTransactionEntity,
      {
        status: 'PENDING_REFERENCE',
        $or: [{ referenceNextAttemptAt: null }, { referenceNextAttemptAt: { $lte: at } }],
      } as FilterQuery<any>,
      { orderBy: { referenceNextAttemptAt: 'ASC', createdAt: 'ASC' }, limit } as any,
    );
    return rows.map((r) => wagerTransactionFromEntity(r as unknown as WagerTransactionRow));
  }

  async save(tx: WagerTransaction): Promise<void> {
    const data = wagerTransactionToEntity(tx);
    const existing = await this.em.findOne(WagerTransactionEntity, { id: tx.id } as FilterQuery<any>);
    if (existing) {
      // mapper hardcodes these DB-managed retry columns to 0/null (no domain
      // field) — strip them so a save never erases worker-set scheduling state
      const { referenceAttempts: _ra, referenceNextAttemptAt: _rna, ...changes } = data;
      this.em.assign(existing, changes as any);
    } else {
      this.em.create(WagerTransactionEntity, data as any);
    }
    await this.em.flush();
  }
}

@Injectable()
export class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  async findByTransactionId(transactionId: string): Promise<WalletLedgerEntry[]> {
    const rows = await this.em.find(
      WalletLedgerEntryEntity,
      { transactionId } as FilterQuery<any>,
      { orderBy: { createdAt: 'ASC' } } as any,
    );
    return rows.map((r) => ledgerEntryFromEntity(r as unknown as WalletLedgerEntryRow));
  }

  async findByWalletId(walletId: string, limit = 1000): Promise<WalletLedgerEntry[]> {
    const rows = await this.em.find(
      WalletLedgerEntryEntity,
      { walletId } as FilterQuery<any>,
      { orderBy: { createdAt: 'ASC' }, limit } as any,
    );
    return rows.map((r) => ledgerEntryFromEntity(r as unknown as WalletLedgerEntryRow));
  }

  async pageByCursor(
    walletId: string,
    cursor?: LedgerCursor | null,
    limit = 50,
  ): Promise<LedgerPage> {
    assertUuid(walletId, 'walletId');
    assertPositiveInt(limit, 'limit');
    const where: Record<string, unknown> = cursor
      ? {
          walletId,
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
          ],
        }
      : { walletId };
    const rows = await this.em.find(
      WalletLedgerEntryEntity,
      where as FilterQuery<any>,
      // fetch one extra row to know whether an older page exists
      { orderBy: { createdAt: 'DESC', id: 'DESC' }, limit: limit + 1 } as any,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      entries: page.map((r) => ledgerEntryFromEntity(r as unknown as WalletLedgerEntryRow)),
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async sumByWallet(walletId: string, currency: string): Promise<string> {
    assertUuid(walletId, 'walletId');
    const rows = (await (this.em as unknown as SqlEntityManager).execute(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN money_amount ELSE -money_amount END), 0)::numeric(20, 2) AS total
         FROM wallet_ledger_entry
        WHERE wallet_id = ? AND money_currency = ?`,
      [walletId, currency],
    )) as { total: string | number | null }[];
    const total = rows[0]?.total;
    return total == null ? '0.00' : String(total);
  }

  async countByWallet(walletId: string): Promise<number> {
    assertUuid(walletId, 'walletId');
    const rows = (await (this.em as unknown as SqlEntityManager).execute(
      `SELECT COUNT(*)::int AS total FROM wallet_ledger_entry WHERE wallet_id = ?`,
      [walletId],
    )) as { total: number }[];
    return rows[0]?.total ?? 0;
  }

  async save(entry: WalletLedgerEntry): Promise<void> {
    const data = ledgerEntryToEntity(entry);
    const existing = await this.em.findOne(WalletLedgerEntryEntity, { id: entry.id } as FilterQuery<any>);
    if (existing) {
      this.em.assign(existing, data as any);
    } else {
      this.em.create(WalletLedgerEntryEntity, data as any);
    }
    await this.em.flush();
  }
}

@Injectable()
export class MikroOrmInboxMessageRepository implements InboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const row = await this.em.findOne(InboxMessageEntity, { consumerName, messageId } as FilterQuery<any>);
    return row ? inboxMessageFromEntity(row as unknown as InboxMessageRow) : null;
  }

  async save(message: InboxMessage): Promise<void> {
    // insert-only: duplicates on (consumer_name, message_id) surface as a
    // unique violation; callers detect it with isUniqueViolation().
    this.em.create(InboxMessageEntity, inboxMessageToEntity(message) as any);
    await this.em.flush();
  }

  async markProcessed(consumerName: string, messageId: string, at: Date): Promise<void> {
    const row = await this.em.findOne(
      InboxMessageEntity,
      { consumerName, messageId } as FilterQuery<any>,
    );
    if (!row) {
      throw new Error(`inbox message not found: ${consumerName}/${messageId}`);
    }
    (row as { processedAt: Date }).processedAt = at;
    await this.em.flush();
  }
}

@Injectable()
export class MikroOrmOutboxMessageRepository implements OutboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  async findPending(limit = 100): Promise<OutboxMessage[]> {
    const rows = await this.em.find(
      OutboxMessageEntity,
      { publishedAt: null } as FilterQuery<any>,
      { orderBy: { occurredAt: 'ASC' }, limit } as any,
    );
    return rows.map((r) => outboxMessageFromEntity(r as unknown as OutboxMessageRow));
  }

  async findDue(now: Date, limit = 100): Promise<OutboxMessage[]> {
    const rows = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      } as FilterQuery<any>,
      { orderBy: { occurredAt: 'ASC' }, limit } as any,
    );
    return rows.map((r) => outboxMessageFromEntity(r as unknown as OutboxMessageRow));
  }

  async save(message: OutboxMessage): Promise<void> {
    await this.persist(this.em, message);
  }

  private async persist(em: EntityManager, message: OutboxMessage): Promise<void> {
    const data = outboxMessageToEntity(message);
    const existing = await em.findOne(OutboxMessageEntity, { id: message.id } as FilterQuery<any>);
    if (existing) {
      em.assign(existing, data as any);
    } else {
      em.create(OutboxMessageEntity, data as any);
    }
    await em.flush();
  }

  async claimDueBatch(em: EntityManager, limit = 100): Promise<OutboxMessage[]> {
    assertPositiveInt(limit, 'limit');
    // FOR UPDATE SKIP LOCKED is only exclusive inside a transaction — fail
    // closed instead of silently claiming without a retained lock
    if (!em.isInTransaction()) {
      throw new Error('claimDueBatch requires an active transaction (em.transactional() or begin())');
    }
    // raw query: SKIP LOCKED is not expressible via em.find(); em.execute (not
    // em.getConnection().execute) keeps it inside the caller's transaction.
    const dueBy = new Date().toISOString();
    const rows = (await (em as unknown as SqlEntityManager).execute(
      `SELECT id, aggregate_id AS "aggregateId", event_type AS "eventType", payload,
              occurred_at AS "occurredAt", attempts,
              next_attempt_at AS "nextAttemptAt", published_at AS "publishedAt"
         FROM outbox_message
        WHERE published_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY next_attempt_at ASC NULLS FIRST, occurred_at ASC
        LIMIT ?
          FOR UPDATE SKIP LOCKED`,
      [dueBy, limit],
    )) as unknown as OutboxMessageRow[];
    return rows.map((r) => outboxMessageFromEntity(r));
  }

  async markPublished(em: EntityManager, message: OutboxMessage, at: Date): Promise<void> {
    message.markPublished(at);
    await this.persist(em, message);
  }

  async scheduleRetry(em: EntityManager, message: OutboxMessage, now: Date): Promise<void> {
    message.scheduleRetry(now);
    await this.persist(em, message);
  }
}
