import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager, FilterQuery } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import type { SqlEntityManager } from '@mikro-orm/sql';
import { v4 } from 'uuid';
import { WalletEntity } from '../../src/database/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/database/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/database/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../src/database/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/database/entities/outbox-message.entity';
import {
  MikroOrmWalletRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerEntryRepository,
  MikroOrmOutboxMessageRepository,
} from '../../src/database/repositories';
import { Wallet } from '../../src/domain/wallet/wallet';
import { WagerTransaction } from '../../src/domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../../src/domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../../src/domain/outbox/outbox-message';
import { Money } from '../../src/domain/money/money';
import { LedgerDirection, WagerTransactionKind } from '../../src/domain/enums';

describe('repository extensions (T022: locking, keyset paging, claims)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  const newTx = (overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) =>
    WagerTransaction.create({
      id: v4(),
      providerId: 'provider-1',
      externalTransactionId: v4(),
      idempotencyKey: `idem-${v4()}`,
      payloadHash: 'payload-hash',
      walletId: v4(),
      playerId: v4(),
      roundId: v4(),
      gameId: v4(),
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
      createdAt: new Date(),
      ...overrides,
    });

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [
        WalletEntity,
        WagerTransactionEntity,
        WalletLedgerEntryEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: PostgreSqlDriver,
    });
    em = orm.em.fork();
    // ledger rows are immutable (trigger) — DELETE is blocked, TRUNCATE skips row triggers
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
  });

  afterAll(async () => {
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
    await orm.close();
  });

  describe('WalletRepository.findByIdForUpdate', () => {
    it('locks the wallet row until its transaction ends', async () => {
      const seedRepo = new MikroOrmWalletRepository(em);
      const wallet = Wallet.open({
        id: v4(),
        playerId: v4(),
        initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
      });
      await seedRepo.save(wallet);

      const em1 = orm.em.fork();
      const em2 = orm.em.fork();
      let ready!: () => void;
      const readyP = new Promise<void>((r) => (ready = r));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));

      const tx1 = em1.transactional(async (tx) => {
        const found = await new MikroOrmWalletRepository(tx).findByIdForUpdate(wallet.id);
        expect(found?.id).toBe(wallet.id);
        ready();
        await gate;
      });
      await readyP;
      try {
        // second writer must fail fast on the held lock instead of blocking
        await expect(
          em2.transactional(async (tx) => {
            await (tx as unknown as SqlEntityManager).execute(`SET LOCAL lock_timeout = '250ms'`);
            await new MikroOrmWalletRepository(tx).findByIdForUpdate(wallet.id);
          }),
        ).rejects.toThrow(/lock timeout/i);
      } finally {
        release();
        await tx1;
      }
    });
  });

  describe('WagerTransactionRepository.findPendingReferenceDue', () => {
    it('returns only PENDING_REFERENCE rows that are due at the given time', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const at = new Date('2026-02-01T00:00:00Z');

      const neverScheduled = newTx();
      neverScheduled.markPendingReference();
      await repo.save(neverScheduled);

      const due = newTx();
      due.markPendingReference();
      await repo.save(due);

      const future = newTx();
      future.markPendingReference();
      await repo.save(future);

      const pending = newTx(); // status PENDING — must never be picked up
      await repo.save(pending);

      const patch = async (tx: WagerTransaction, next: Date | null) => {
        const row = await em.findOne(WagerTransactionEntity, { id: tx.id } as FilterQuery<any>);
        (row as { referenceNextAttemptAt: Date | null }).referenceNextAttemptAt = next;
        await em.flush();
      };
      // mapper hardcodes these columns to 0/null on save — schedule at the
      // entity level, exactly like the Phase 7 worker will
      await patch(due, new Date('2026-01-31T23:00:00Z'));
      await patch(future, new Date('2026-02-01T01:00:00Z'));

      const results = await repo.findPendingReferenceDue(at);
      const ids = results.map((t) => t.id);
      expect(ids).toContain(neverScheduled.id);
      expect(ids).toContain(due.id);
      expect(ids).not.toContain(future.id);
      expect(ids).not.toContain(pending.id);
      // scheduled-attempt rows order before never-scheduled (nulls last in ASC)
      expect(ids.indexOf(due.id)).toBeLessThan(ids.indexOf(neverScheduled.id));
      expect(results.every((t) => t.status === 'PENDING_REFERENCE')).toBe(true);
      em.clear();
    });

    it('save() update path does not erase DB-managed reference retry columns', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const tx = newTx();
      tx.markPendingReference();
      await repo.save(tx);

      // schedule exactly like the Phase 7 worker will (entity-level write)
      const row = await em.findOne(WagerTransactionEntity, { id: tx.id } as FilterQuery<any>);
      (row as { referenceAttempts: number }).referenceAttempts = 3;
      (row as { referenceNextAttemptAt: Date | null }).referenceNextAttemptAt = new Date(
        '2026-05-01T00:00:00Z',
      );
      await em.flush();
      em.clear();

      // reload → repo.save (update path) — without the strip, mapper's
      // hardcoded 0/null would wipe the scheduled state
      const reloaded = await repo.findById(tx.id);
      expect(reloaded).not.toBeNull();
      await repo.save(reloaded!);

      const stored = (await em.getConnection().execute(
        `SELECT reference_attempts, reference_next_attempt_at
           FROM wager_transaction WHERE id = '${tx.id}'`,
      )) as { reference_attempts: number; reference_next_attempt_at: Date }[];
      expect(stored[0]!.reference_attempts).toBe(3);
      expect(new Date(stored[0]!.reference_next_attempt_at).getTime()).toBe(
        new Date('2026-05-01T00:00:00Z').getTime(),
      );
      em.clear();
    });
  });

  describe('WalletLedgerEntryRepository.pageByCursor', () => {
    const seedEntries = async (walletId: string, createdAt: Date, count: number) => {
      const repo = new MikroOrmWalletLedgerEntryRepository(em);
      const entries: WalletLedgerEntry[] = [];
      let before = Money.from({ amount: '0.00', currency: 'BRL' });
      for (let i = 0; i < count; i++) {
        const amount = Money.from({ amount: '10.00', currency: 'BRL' });
        const after = Money.from({ amount: `${((i + 1) * 10).toFixed(2)}`, currency: 'BRL' });
        const entry = WalletLedgerEntry.create({
          walletId,
          transactionId: v4(),
          direction: LedgerDirection.Credit,
          money: amount,
          balanceBefore: before,
          balanceAfter: after,
          createdAt,
        });
        await repo.save(entry);
        entries.push(entry);
        before = after;
      }
      return entries;
    };

    it('walks pages newest-first without duplicates or gaps (distinct timestamps)', async () => {
      const walletId = v4();
      const base = new Date('2026-03-01T00:00:00Z');
      for (let i = 0; i < 5; i++) {
        await seedEntries(walletId, new Date(base.getTime() + i * 1000), 1);
      }

      const repo = new MikroOrmWalletLedgerEntryRepository(em);
      const p1 = await repo.pageByCursor(walletId, null, 2);
      expect(p1.entries).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await repo.pageByCursor(walletId, p1.nextCursor, 2);
      expect(p2.entries).toHaveLength(2);
      expect(p2.nextCursor).not.toBeNull();
      const p3 = await repo.pageByCursor(walletId, p2.nextCursor, 2);
      expect(p3.entries).toHaveLength(1);
      expect(p3.nextCursor).toBeNull();

      const walked = [...p1.entries, ...p2.entries, ...p3.entries];
      expect(walked).toHaveLength(5);
      expect(new Set(walked.map((e) => e.id)).size).toBe(5);
      // newest-first
      for (let i = 1; i < walked.length; i++) {
        expect(walked[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
          walked[i]!.createdAt.getTime(),
        );
      }
      em.clear();
    });

    it('tie-breaks equal timestamps by id descending (no dup/skip)', async () => {
      const walletId = v4();
      const sameInstant = new Date('2026-03-02T00:00:00Z');
      await seedEntries(walletId, sameInstant, 3);

      const repo = new MikroOrmWalletLedgerEntryRepository(em);
      const p1 = await repo.pageByCursor(walletId, null, 1);
      const p2 = await repo.pageByCursor(walletId, p1.nextCursor, 1);
      const p3 = await repo.pageByCursor(walletId, p2.nextCursor, 1);
      expect(p1.nextCursor).not.toBeNull();
      expect(p2.nextCursor).not.toBeNull();
      expect(p3.nextCursor).toBeNull();

      const walked = [...p1.entries, ...p2.entries, ...p3.entries];
      expect(walked).toHaveLength(3);
      expect(new Set(walked.map((e) => e.id)).size).toBe(3);
      for (let i = 1; i < walked.length; i++) {
        expect(walked[i - 1]!.id > walked[i]!.id).toBe(true);
      }
      em.clear();
    });
  });

  describe('WalletLedgerEntryRepository.sumByWallet', () => {
    it('reconstructs the balance as credit minus debit', async () => {
      const repo = new MikroOrmWalletLedgerEntryRepository(em);
      const walletId = v4();
      const tx1 = v4();
      const tx2 = v4();
      await repo.save(
        WalletLedgerEntry.create({
          walletId,
          transactionId: tx1,
          direction: LedgerDirection.Credit,
          money: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '0.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
          createdAt: new Date(),
        }),
      );
      await repo.save(
        WalletLedgerEntry.create({
          walletId,
          transactionId: tx2,
          direction: LedgerDirection.Debit,
          money: Money.from({ amount: '30.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
          createdAt: new Date(),
        }),
      );

      expect(await repo.sumByWallet(walletId)).toBe('70.00');
      expect(await repo.sumByWallet(v4())).toBe('0.00');
      em.clear();
    });
  });

  describe('OutboxMessageRepository.claimDueBatch', () => {
    const enqueue = (occurredAt: Date) =>
      OutboxMessage.enqueue({
        eventId: v4(),
        aggregateId: v4(),
        eventType: 'TestEvent',
        payload: { kind: 'claim' },
        occurredAt,
      });

    it('claims only due, unpublished rows inside the caller transaction (rolled back)', async () => {
      const now = new Date();
      const worker = orm.em.fork();
      // seeds + claim share the worker context so rollback erases everything
      const repo = new MikroOrmOutboxMessageRepository(worker);
      await worker.begin();
      try {
        const dueNull = enqueue(now);
        await repo.save(dueNull);
        const duePast = enqueue(now);
        await repo.save(duePast);
        const future = enqueue(now);
        future.scheduleRetry(new Date(Date.now() + 3600_000)); // due in ~1h, never now
        await repo.save(future);
        const published = enqueue(now);
        await repo.save(published);
        await repo.markPublished(worker, published, now);

        const claimed = await repo.claimDueBatch(worker, 50);
        const ids = claimed.map((m) => m.id);
        expect(ids).toContain(dueNull.id);
        expect(ids).toContain(duePast.id);
        expect(ids).not.toContain(future.id);
        expect(ids).not.toContain(published.id);
        const got = claimed.find((m) => m.id === dueNull.id);
        expect(got?.eventType).toBe('TestEvent');
        expect(got?.payload).toEqual({ kind: 'claim' });
        expect(got?.attempts).toBe(0);
        expect(got?.isPending()).toBe(true);
      } finally {
        await worker.rollback();
      }
      // rollback dropped every seed — nothing leaked into committed state
      const leftovers = await em.find(OutboxMessageEntity, {} as FilterQuery<any>);
      expect(leftovers).toHaveLength(0);
    });

    it('rejects outside a transaction (SKIP LOCKED would claim without a retained lock)', async () => {
      const repo = new MikroOrmOutboxMessageRepository(em);
      await expect(repo.claimDueBatch(em, 10)).rejects.toThrow(/transaction/i);
    });

    it('SKIP LOCKED: a second claim skips a committed row locked by the first', async () => {
      const now = new Date();
      const em1 = orm.em.fork();
      const em2 = orm.em.fork();
      // commit the seed first: em2 must SEE it (otherwise MVCC, not SKIP
      // LOCKED, would hide it) — only the lock may make em2 skip it
      const mine = enqueue(now);
      await new MikroOrmOutboxMessageRepository(em).save(mine);
      await em1.begin();
      await em2.begin();
      try {
        const first = await new MikroOrmOutboxMessageRepository(em1).claimDueBatch(em1, 50);
        expect(first.map((m) => m.id)).toContain(mine.id);

        const second = await new MikroOrmOutboxMessageRepository(em2).claimDueBatch(em2, 50);
        expect(second.map((m) => m.id)).not.toContain(mine.id);
      } finally {
        await em1.rollback();
        await em2.rollback();
        await em.nativeDelete(OutboxMessageEntity, { id: mine.id } as FilterQuery<any>);
      }
      em.clear();
    });
  });

  describe('OutboxMessageRepository.markPublished / scheduleRetry', () => {
    it('persists publication and backoff scheduling through the given em', async () => {
      const repo = new MikroOrmOutboxMessageRepository(em);
      const now = new Date('2026-04-01T00:00:00Z');

      const published = OutboxMessage.enqueue({
        eventId: v4(),
        aggregateId: v4(),
        eventType: 'TestEvent',
        payload: { kind: 'pub' },
        occurredAt: now,
      });
      await repo.save(published);
      await repo.markPublished(em, published, now);
      expect(published.isPublished()).toBe(true);
      const pubRows = (await em
        .getConnection()
        .execute(`SELECT published_at FROM outbox_message WHERE id = '${published.id}'`)) as {
        published_at: Date;
      }[];
      expect(new Date(pubRows[0]!.published_at).getTime()).toBe(now.getTime());
      expect((await repo.findPending()).some((m) => m.id === published.id)).toBe(false);

      const failing = OutboxMessage.enqueue({
        eventId: v4(),
        aggregateId: v4(),
        eventType: 'TestEvent',
        payload: { kind: 'retry' },
        occurredAt: now,
      });
      await repo.save(failing);
      await repo.scheduleRetry(em, failing, now);
      expect(failing.attempts).toBe(1);
      // 2^1 seconds backoff from `now`
      expect(failing.nextAttemptAt!.getTime()).toBe(now.getTime() + 2000);
      expect((await repo.findDue(now)).map((m) => m.id)).not.toContain(failing.id);
      expect((await repo.findDue(new Date(now.getTime() + 3000))).map((m) => m.id)).toContain(
        failing.id,
      );
      em.clear();
    });
  });
});
