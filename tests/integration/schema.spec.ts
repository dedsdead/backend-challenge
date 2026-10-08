import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
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
  MikroOrmInboxMessageRepository,
  MikroOrmOutboxMessageRepository,
  isUniqueViolation,
} from '../../src/database/repositories';
import { Migration20261007000000_InitialMigration } from '../../src/database/migrations/Migration20261007000000_InitialMigration';
import { Wallet } from '../../src/domain/wallet/wallet';
import { WagerTransaction } from '../../src/domain/wager-transaction/wager-transaction';
import { WalletLedgerEntry } from '../../src/domain/ledger/wallet-ledger-entry';
import { InboxMessage } from '../../src/domain/inbox/inbox-message';
import { OutboxMessage } from '../../src/domain/outbox/outbox-message';
import { Money } from '../../src/domain/money/money';
import { LedgerDirection, WagerTransactionKind } from '../../src/domain/enums';
import { acquireTestLock, releaseTestLock } from '../helpers/test-db-lock';

describe('migrated schema and repositories', () => {
  let orm: MikroORM;
  let em: EntityManager;

  const exec = (sql: string) => em.getConnection().execute(sql) as Promise<Record<string, string>[]>;

  const MIGRATED_TABLES = [
    'inbox_message',
    'mikro_orm_migrations',
    'outbox_message',
    'wager_transaction',
    'wallet',
    'wallet_ledger_entry',
  ];

beforeAll(async () => {
    await acquireTestLock();
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
    // wallet_ledger_entry is append-only (immutability trigger); DELETE is
    // blocked, so clean it with TRUNCATE (row triggers do not fire).
    await em.getConnection().execute('TRUNCATE TABLE wallet_ledger_entry');
    await em.nativeDelete(WagerTransactionEntity, {} as never);
    await em.nativeDelete(WalletEntity, {} as never);
    await em.nativeDelete(InboxMessageEntity, {} as never);
    await em.nativeDelete(OutboxMessageEntity, {} as never);
  });

afterAll(async () => {
    await orm.close();
    await releaseTestLock();
  });

  describe('schema structure', () => {
    it('has all migrated tables', async () => {
      const rows = await exec(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      expect(rows.map((r) => r.tablename)).toEqual(MIGRATED_TABLES);
    });

    it('records migration 001 as executed', async () => {
      const rows = await exec(`SELECT name FROM mikro_orm_migrations`);
      expect(rows.map((r) => r.name)).toContain('Migration20261007000000_InitialMigration');
    });

    it('has check constraints from the entities', async () => {
      const rows = await exec(
        `SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'c' ORDER BY conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        'ck_ledger_balanced',
        'ck_wager_tx_ref_required',
        'ck_wallet_balance_non_negative',
      ]);
    });

it('has unique indexes from the entities', async () => {
      const rows = await exec(
        `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'uq\\_%' ORDER BY indexname`,
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        'uq_inbox_consumer_message',
        'uq_wager_tx_idempotency_key',
        'uq_wager_tx_provider_external',
        'uq_wager_tx_reference_kind',
        'uq_wallet_player_currency',
      ]);
    });

    it('has NO foreign keys (deliberate: WALLET_NOT_FOUND rejection rows intentionally store dangling wallet_id)', async () => {
      const rows = await exec(
        `SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'f' ORDER BY conname`,
      );
      expect(rows).toHaveLength(0);
    });

it('has plain indexes from the entities', async () => {
      const rows = await exec(
        `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx\\_%' ORDER BY indexname`,
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        'idx_inbox_consumer_message',
        'idx_ledger_transaction_id',
        'idx_ledger_wallet_created_id',
        'idx_ledger_wallet_id',
        'idx_outbox_published_next_attempt',
        'idx_wager_tx_reference_tx_id',
        'idx_wager_tx_status',
        'idx_wager_tx_status_ref_next_attempt',
        'idx_wager_tx_wallet_id',
        'idx_wallet_player_id',
      ]);
    });

    it('partial unique on (reference_transaction_id, kind) only applies to PROCESSED', async () => {
      const rows = await exec(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_wager_tx_reference_kind'`,
      );
      expect(rows[0]?.indexdef).toContain('WHERE');
      expect(rows[0]?.indexdef).toContain("'PROCESSED'");
    });

    it('migration up/down round-trips on a scratch schema', async () => {
      const collectSql = async (kind: 'up' | 'down') => {
        const mig = new Migration20261007000000_InitialMigration(
          orm.driver as never,
          orm.config as never,
        );
        if (kind === 'up') {
          await mig.up();
        } else {
          await mig.down();
        }
        return mig.getQueries().map((q) => {
          if (typeof q !== 'string') {
            throw new Error('expected raw SQL from migration');
          }
          // split multi-statement blocks so each execute() runs one command
          const statements: string[] = [];
          let current = '';
          let inDollarQuote = false;
          for (let i = 0; i < q.length; i++) {
            if (q.startsWith('$$', i)) {
              inDollarQuote = !inDollarQuote;
              current += '$$';
              i++;
              continue;
            }
            if (q[i] === ';' && !inDollarQuote) {
              if (current.trim()) {
                statements.push(`${current.trim()};`);
              }
              current = '';
              continue;
            }
            current += q[i];
          }
          if (current.trim()) {
            statements.push(current.trim());
          }
          return statements;
        }).flat();
      };

      const runInScratch = async (statements: string[]) => {
        await em.transactional(async (tx) => {
          const sqlEm = tx as unknown as SqlEntityManager;
          await sqlEm.execute(`SET LOCAL search_path TO scratch_mig`);
          for (const statement of statements) {
            await sqlEm.execute(statement);
          }
        });
      };

      const scratchTables = async () =>
        (
          await exec(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'scratch_mig' ORDER BY tablename`,
          )
        ).map((r) => r.tablename);

      await exec(`DROP SCHEMA IF EXISTS scratch_mig CASCADE`);
      await exec(`CREATE SCHEMA scratch_mig`);
      try {
        const upSql = await collectSql('up');
        const downSql = await collectSql('down');

        await runInScratch(upSql);
        expect(await scratchTables()).toEqual(MIGRATED_TABLES);
        const triggers = await exec(
          `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'scratch_mig.wallet_ledger_entry'::regclass`,
        );
        expect(triggers.map((r) => r.tgname)).toContain('trg_wallet_ledger_entry_immutable');

        await runInScratch(downSql);
        // mikro_orm_migrations is migrator-owned and survives down()
        expect(await scratchTables()).toEqual(['mikro_orm_migrations']);

        await runInScratch(upSql);
        expect(await scratchTables()).toEqual(MIGRATED_TABLES);
      } finally {
        await exec(`DROP SCHEMA IF EXISTS scratch_mig CASCADE`);
      }
    });
  });

  describe('WalletRepository', () => {
    it('round-trips a wallet through save and findById', async () => {
      const repo = new MikroOrmWalletRepository(em);
      const wallet = Wallet.open({
        id: v4(),
        playerId: v4(),
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });
      await repo.save(wallet);

      const found = await repo.findById(wallet.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(wallet.id);
      expect(found!.playerId).toBe(wallet.playerId);
      expect(found!.currency).toBe('BRL');
      expect(found!.balance.amount).toBe('100.00');
      expect(found!.version).toBe(1);

      const { wallet: debited } = wallet.debit(
        Money.from({ amount: '30.00', currency: 'BRL' }),
        new Date(),
      );
      await repo.save(debited);

      const reloaded = await repo.findById(wallet.id);
      expect(reloaded!.balance.amount).toBe('70.00');
      expect(reloaded!.version).toBe(2);
    });

    it('finds a wallet by playerId and currency', async () => {
      const repo = new MikroOrmWalletRepository(em);
      const playerId = v4();
      const wallet = Wallet.open({
        id: v4(),
        playerId,
        initialBalance: Money.from({ amount: '10.00', currency: 'USD' }),
      });
      await repo.save(wallet);

      const found = await repo.findByPlayerIdAndCurrency(playerId, 'USD');
      expect(found?.id).toBe(wallet.id);
      expect(await repo.findByPlayerIdAndCurrency(playerId, 'EUR')).toBeNull();
    });

    it('rejects concurrent updates via optimistic locking (version column)', async () => {
      const em1 = orm.em.fork();
      const em2 = orm.em.fork();
      const repo1 = new MikroOrmWalletRepository(em1);
      const repo2 = new MikroOrmWalletRepository(em2);

      const wallet = Wallet.open({
        id: v4(),
        playerId: v4(),
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });
      await repo1.save(wallet);

      const a = await repo1.findById(wallet.id);
      const b = await repo2.findById(wallet.id);

      const { wallet: a2 } = a!.debit(Money.from({ amount: '10.00', currency: 'BRL' }), new Date());
      await repo1.save(a2);

      const { wallet: b2 } = b!.credit(Money.from({ amount: '5.00', currency: 'BRL' }), new Date());
      await expect(repo2.save(b2)).rejects.toThrow();

      const final = await repo1.findById(wallet.id);
      expect(final!.balance.amount).toBe('90.00');
      expect(final!.version).toBe(2);
    });

    it('rejects a duplicate wallet (player + currency) at the database level', async () => {
      const em2 = orm.em.fork();
      const repo = new MikroOrmWalletRepository(em2);
      const playerId = v4();
      await repo.save(
        Wallet.open({
          id: v4(),
          playerId,
          initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
        }),
      );
      await expect(
        repo.save(
          Wallet.open({
            id: v4(),
            playerId,
            initialBalance: Money.from({ amount: '5.00', currency: 'BRL' }),
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects a negative balance at the database level (CHECK)', async () => {
      const em2 = orm.em.fork();
      em2.create(
        WalletEntity,
        {
          playerId: v4(),
          currency: 'BRL',
          balanceAmount: '-0.01',
        } as never,
      );
      await expect(em2.flush()).rejects.toThrow();
    });
  });

  describe('WagerTransactionRepository', () => {
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

    it('round-trips a pending transaction', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const tx = newTx();
      await repo.save(tx);

      const byId = await repo.findById(tx.id);
      expect(byId).not.toBeNull();
      expect(byId!.status).toBe('PENDING');
      expect(byId!.kind).toBe(WagerTransactionKind.Bet);
      expect(byId!.money.amount).toBe('10.00');
      expect(byId!.money.currency).toBe('BRL');

      expect((await repo.findByIdempotencyKey(tx.idempotencyKey))?.id).toBe(tx.id);
      expect(
        (await repo.findByProviderAndExternal('provider-1', tx.externalTransactionId))?.id,
      ).toBe(tx.id);
      expect(await repo.findByIdempotencyKey('missing')).toBeNull();
    });

    it('round-trips a processed transaction with failure/result fields', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const tx = newTx();
      tx.markProcessed(undefined, new Date('2026-01-01T00:00:00Z'));
      tx.setResultBalance(Money.from({ amount: '90.00', currency: 'BRL' }));
      await repo.save(tx);

      const found = await repo.findById(tx.id);
      expect(found!.status).toBe('PROCESSED');
      expect(found!.processedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(found!.resultBalance?.amount).toBe('90.00');
      expect(found!.resultBalance?.currency).toBe('BRL');
    });

    it('rejects duplicate idempotency keys at the database level', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const key = `idem-${v4()}`;
      await repo.save(newTx({ idempotencyKey: key }));
      await expect(repo.save(newTx({ idempotencyKey: key }))).rejects.toThrow();
      em.clear(); // failed flush leaves entities pending; reset for later tests
    });

    it('partial unique allows same reference+kind while PENDING but rejects when PROCESSED', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const referenceId = v4();

      const p1 = newTx();
      const p2 = newTx();
      await repo.save(p1);
      await repo.save(p2);

      p1.markProcessed(referenceId, new Date());
      await repo.save(p1);
      p2.markProcessed(referenceId, new Date());
      await expect(repo.save(p2)).rejects.toThrow();
      em.clear(); // failed flush leaves entities pending; reset for later tests
    });

    it('lists transactions in PENDING_REFERENCE ordered by createdAt', async () => {
      const repo = new MikroOrmWagerTransactionRepository(em);
      const tx = newTx();
      tx.markPendingReference();
      await repo.save(tx);

      const pending = await repo.findPendingReference();
      expect(pending.some((t) => t.id === tx.id)).toBe(true);
      expect(pending.every((t) => t.status === 'PENDING_REFERENCE')).toBe(true);
    });

    it('rejects a duplicate provider + external transaction id at the database level', async () => {
      const em2 = orm.em.fork();
      const repo = new MikroOrmWagerTransactionRepository(em2);
      const externalTransactionId = v4();
      await repo.save(newTx({ externalTransactionId }));
      await expect(repo.save(newTx({ externalTransactionId }))).rejects.toThrow();
    });

    it('accepts mixed kinds for the same reference while PROCESSED (partial unique)', async () => {
      const em2 = orm.em.fork();
      const repo = new MikroOrmWagerTransactionRepository(em2);
      const referenceId = v4();
      const bet = newTx();
      const win = newTx({ kind: WagerTransactionKind.Win });
      bet.markProcessed(referenceId, new Date());
      win.markProcessed(referenceId, new Date());
      await repo.save(bet);
      await repo.save(win);
      expect((await repo.findById(bet.id))!.status).toBe('PROCESSED');
      expect((await repo.findById(win.id))!.status).toBe('PROCESSED');
    });
  });

  describe('WalletLedgerEntryRepository', () => {
    it('round-trips a balanced ledger entry', async () => {
      const repo = new MikroOrmWalletLedgerEntryRepository(em);
      const walletId = v4();
      const transactionId = v4();
      const entry = WalletLedgerEntry.create({
        walletId,
        transactionId,
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '30.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
        createdAt: new Date(),
      });
      await repo.save(entry);

      const byTx = await repo.findByTransactionId(transactionId);
      expect(byTx).toHaveLength(1);
      expect(byTx[0]!.money.amount).toBe('30.00');
      expect(byTx[0]!.direction).toBe(LedgerDirection.Debit);
      expect(byTx[0]!.isBalanced()).toBe(true);

      const byWallet = await repo.findByWalletId(walletId);
      expect(byWallet).toHaveLength(1);
      expect(byWallet[0]!.id).toBe(entry.id);
    });

    it('database rejects unbalanced ledger arithmetic (check constraint)', async () => {
      const em2 = orm.em.fork();
      em2.create(WalletLedgerEntryEntity, {
        id: v4(),
        walletId: v4(),
        transactionId: v4(),
        direction: 'DEBIT',
        moneyAmount: '30.00',
        moneyCurrency: 'BRL',
        balanceBeforeAmount: '100.00',
        balanceBeforeCurrency: 'BRL',
        balanceAfterAmount: '99.99',
        balanceAfterCurrency: 'BRL',
        createdAt: new Date(),
      } as never);
      await expect(em2.flush()).rejects.toThrow();
    });

    it('database blocks UPDATE and DELETE (immutability trigger)', async () => {
      const em2 = orm.em.fork();
      const entry = em2.create(WalletLedgerEntryEntity, {
        walletId: v4(),
        transactionId: v4(),
        direction: 'DEBIT',
        moneyAmount: '30.00',
        moneyCurrency: 'BRL',
        balanceBeforeAmount: '100.00',
        balanceBeforeCurrency: 'BRL',
        balanceAfterAmount: '70.00',
        balanceAfterCurrency: 'BRL',
        createdAt: new Date(),
      } as never);
      await em2.flush();

      const id = (entry as { id: string }).id;
      await expect(
        em2
          .getConnection()
          .execute(`UPDATE wallet_ledger_entry SET direction = 'CREDIT' WHERE id = '${id}'`),
      ).rejects.toThrow(/immutable/);
      await expect(
        em2.getConnection().execute(`DELETE FROM wallet_ledger_entry WHERE id = '${id}'`),
      ).rejects.toThrow(/immutable/);

      const rows = (await em2
        .getConnection()
        .execute(`SELECT id FROM wallet_ledger_entry WHERE id = '${id}'`)) as { id: string }[];
      expect(rows).toHaveLength(1);
    });
  });

  describe('InboxMessageRepository', () => {
    it('round-trips and deduplicates by consumer + messageId', async () => {
      const repo = new MikroOrmInboxMessageRepository(em);
      const messageId = v4();
      const msg = InboxMessage.receive({
        messageId,
        consumerName: 'consumer-a',
        payloadHash: 'hash-a',
        receivedAt: new Date(),
      });
      await repo.save(msg);

      const found = await repo.findByConsumerAndMessageId('consumer-a', messageId);
      expect(found).not.toBeNull();
      expect(found!.payloadHash).toBe('hash-a');
      expect(found!.isProcessed()).toBe(false);
      expect(await repo.findByConsumerAndMessageId('other', messageId)).toBeNull();

      found!.markProcessed(new Date('2026-01-01T00:00:00Z'));
      await repo.markProcessed('consumer-a', messageId, found!.processedAt!);
      const reloaded = await repo.findByConsumerAndMessageId('consumer-a', messageId);
      expect(reloaded!.isProcessed()).toBe(true);

      const dup = InboxMessage.receive({
        messageId,
        consumerName: 'consumer-a',
        payloadHash: 'hash-different',
        receivedAt: new Date(),
      });
      let caught: unknown;
      try {
        await repo.save(dup);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(isUniqueViolation(caught)).toBe(true);
      expect(isUniqueViolation(new Error('unrelated'))).toBe(false);
      em.clear(); // failed flush leaves entities pending; reset for later tests
    });
  });

  describe('OutboxMessageRepository', () => {
    it('round-trips, lists pending, and respects retry scheduling in findDue', async () => {
      const repo = new MikroOrmOutboxMessageRepository(em);
      const due = OutboxMessage.enqueue({
        eventId: v4(),
        aggregateId: v4(),
        eventType: 'TestEvent',
        payload: { kind: 'due' },
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      });
      await repo.save(due);

      const scheduled = OutboxMessage.enqueue({
        eventId: v4(),
        aggregateId: v4(),
        eventType: 'TestEvent',
        payload: { kind: 'scheduled' },
        occurredAt: new Date('2026-01-01T00:00:01Z'),
      });
      scheduled.scheduleRetry(new Date('2026-01-01T00:00:00Z'));
      await repo.save(scheduled);

      const pending = await repo.findPending();
      expect(pending.some((m) => m.id === due.id)).toBe(true);
      expect(pending.some((m) => m.id === scheduled.id)).toBe(true);

      const dueNow = await repo.findDue(new Date('2026-01-01T00:00:00Z'));
      expect(dueNow.some((m) => m.id === due.id)).toBe(true);
      expect(dueNow.some((m) => m.id === scheduled.id)).toBe(false);

      due.markPublished(new Date('2026-01-01T00:00:05Z'));
      await repo.save(due);
      const stillPending = await repo.findPending();
      expect(stillPending.some((m) => m.id === due.id)).toBe(false);
    });
  });
});
