import { describe, it, expect } from 'bun:test';
import { Money } from '../../../src/domain/money/money';
import { Wallet } from '../../../src/domain/wallet/wallet';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../src/domain/enums';

describe('Wallet', () => {
  describe('open', () => {
    it('creates wallet with initial balance', () => {
      const initialBalance = Money.from({ amount: '100.00', currency: 'BRL' });
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance,
      });

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.equals(initialBalance)).toBe(true);
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toBeInstanceOf(Date);
      expect(wallet.updatedAt).toBeInstanceOf(Date);
    });

    it('creates wallet with zero initial balance', () => {
      const initialBalance = Money.zero('BRL');
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance,
      });

      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it('throws for negative initial balance', () => {
      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: Money.from({ amount: '-10.00', currency: 'BRL' }),
        })
      ).toThrow();
    });
  });

  describe('rehydrate', () => {
    it('reconstructs wallet from persisted state', () => {
      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: '50.00',
        version: 3,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.amount).toBe('50.00');
      expect(wallet.version).toBe(3);
      expect(wallet.createdAt).toEqual(new Date('2024-01-01'));
      expect(wallet.updatedAt).toEqual(new Date('2024-01-02'));
    });
  });

  describe('debit', () => {
    it('debits amount and returns ledger movement', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      const result = wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }), new Date('2024-01-01T10:00:00Z'));

      expect(result.movement.direction).toBe(LedgerDirection.Debit);
      expect(result.movement.money.amount).toBe('30.00');
      expect(result.movement.balanceBefore.amount).toBe('100.00');
      expect(result.movement.balanceAfter.amount).toBe('70.00');
      expect(result.wallet.balance.amount).toBe('70.00');
      expect(result.wallet.version).toBe(2);
    });

    it('throws InsufficientFundsError when balance would go negative', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
      });

      expect(() =>
        wallet.debit(Money.from({ amount: '100.00', currency: 'BRL' }), new Date())
      ).toThrow('Insufficient funds');
    });

    it('throws CurrencyMismatchError for different currency', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      expect(() =>
        wallet.debit(Money.from({ amount: '30.00', currency: 'USD' }), new Date())
      ).toThrow('Currency mismatch');
    });
  });

  describe('credit', () => {
    it('credits amount and returns ledger movement', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      const result = wallet.credit(Money.from({ amount: '50.00', currency: 'BRL' }), new Date('2024-01-01T10:00:00Z'));

      expect(result.movement.direction).toBe(LedgerDirection.Credit);
      expect(result.movement.money.amount).toBe('50.00');
      expect(result.movement.balanceBefore.amount).toBe('100.00');
      expect(result.movement.balanceAfter.amount).toBe('150.00');
      expect(result.wallet.balance.amount).toBe('150.00');
      expect(result.wallet.version).toBe(2);
    });

    it('throws CurrencyMismatchError for different currency', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      expect(() =>
        wallet.credit(Money.from({ amount: '50.00', currency: 'USD' }), new Date())
      ).toThrow('Currency mismatch');
    });
  });

  describe('version', () => {
    it('increments only when balance changes', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      expect(wallet.version).toBe(1);

      const result1 = wallet.debit(Money.from({ amount: '10.00', currency: 'BRL' }), new Date());
      expect(result1.wallet.version).toBe(2);

      const result2 = result1.wallet.credit(Money.from({ amount: '5.00', currency: 'BRL' }), new Date());
      expect(result2.wallet.version).toBe(3);
    });
  });

  describe('getters', () => {
    it('returns balance, version, updatedAt', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      expect(wallet.balance).toBeInstanceOf(Money);
      expect(typeof wallet.version).toBe('number');
      expect(wallet.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('immutability', () => {
    it('debit returns new wallet instance with updated state', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      const result = wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }), new Date('2024-01-01T10:00:00Z'));

      // Original wallet should be unchanged
      expect(wallet.balance.amount).toBe('100.00');
      expect(wallet.version).toBe(1);

      // Result should contain new wallet with updated state
      expect(result.wallet).toBeInstanceOf(Wallet);
      expect(result.wallet.id).toBe('wallet-1');
      expect(result.wallet.balance.amount).toBe('70.00');
      expect(result.wallet.version).toBe(2);
      expect(result.movement.balanceAfter.amount).toBe('70.00');
    });

    it('credit returns new wallet instance with updated state', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      const result = wallet.credit(Money.from({ amount: '50.00', currency: 'BRL' }), new Date('2024-01-01T10:00:00Z'));

      // Original wallet should be unchanged
      expect(wallet.balance.amount).toBe('100.00');
      expect(wallet.version).toBe(1);

      // Result should contain new wallet with updated state
      expect(result.wallet).toBeInstanceOf(Wallet);
      expect(result.wallet.id).toBe('wallet-1');
      expect(result.wallet.balance.amount).toBe('150.00');
      expect(result.wallet.version).toBe(2);
      expect(result.movement.balanceAfter.amount).toBe('150.00');
    });

    it('multiple operations on original wallet each produce correct results', () => {
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });

      const result1 = wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }), new Date('2024-01-01T10:00:00Z'));
      const result2 = wallet.debit(Money.from({ amount: '20.00', currency: 'BRL' }), new Date('2024-01-01T10:01:00Z'));

      // Both operations on original wallet should work independently
      expect(result1.wallet.balance.amount).toBe('70.00');
      expect(result2.wallet.balance.amount).toBe('80.00'); // 100 - 20

      // Original wallet unchanged
      expect(wallet.balance.amount).toBe('100.00');
    });
  });
});