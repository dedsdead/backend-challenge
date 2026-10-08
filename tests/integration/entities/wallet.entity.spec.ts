import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { WalletEntity } from '../../../src/database/entities/wallet.entity';

describe('WalletEntity', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [WalletEntity],
      dbName: 'wagering',
      user: 'postgres',
      password: 'local',
      host: 'localhost',
      port: 5432,
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
    });
    em = orm.em.fork();
    // Schema is owned by migration 001; clean rows so runs are idempotent.
    await em.nativeDelete(WalletEntity, {} as never);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('should create a wallet with valid data', async () => {
    const wallet = em.create(WalletEntity, {
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      balanceAmount: '100.00',
    } as never) as any;

    await em.persist(wallet).flush();

    expect(wallet.id).toBeDefined();
    expect(wallet.playerId).toBe('0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balanceAmount).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toBeInstanceOf(Date);
    expect(wallet.updatedAt).toBeInstanceOf(Date);
  });

  it('should reject duplicate wallet for same playerId + currency', async () => {
    const wallet1 = em.create(WalletEntity, {
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b1',
      currency: 'BRL',
      balanceAmount: '100.00',
    } as never) as any;
    await em.persist(wallet1).flush();
    const wallet2 = em.create(WalletEntity, {
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b1',
      currency: 'BRL',
      balanceAmount: '200.00',
    } as never) as any;
    em.persist(wallet2);

    await expect(em.flush()).rejects.toThrow();
  });

  it('should reject negative balance', async () => {
    const wallet = em.create(WalletEntity, {
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4c1',
      currency: 'BRL',
      balanceAmount: '-10.00',
    } as never) as any;
    em.persist(wallet);

    await expect(em.flush()).rejects.toThrow();
  });

  it('should increment version on balance update', async () => {
    const wallet = em.create(WalletEntity, {
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4d1',
      currency: 'BRL',
      balanceAmount: '100.00',
    } as never) as any;
    await em.persist(wallet).flush();

    expect(wallet.version).toBe(1);
    wallet.balanceAmount = '50.00';
    await em.flush();

    expect(wallet.version).toBe(2);
  });
});