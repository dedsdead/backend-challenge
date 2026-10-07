import { describe, it, expect } from 'bun:test';
import { Money } from '../../../src/domain/money/money';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../src/domain/enums';

describe('WalletLedgerEntry', () => {
  describe('create', () => {
    it('creates a valid DEBIT entry', () => {
      const entry = WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '30.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(entry.id).toBe('entry-1');
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.amount).toBe('30.00');
      expect(entry.balanceBefore.amount).toBe('100.00');
      expect(entry.balanceAfter.amount).toBe('70.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('creates a valid CREDIT entry', () => {
      const entry = WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.balanceAfter.amount).toBe('100.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('throws for unbalanced DEBIT entry', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: 'entry-1',
          walletId: 'wallet-1',
          transactionId: 'tx-1',
          direction: LedgerDirection.Debit,
          money: Money.from({ amount: '30.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '69.00', currency: 'BRL' }), // Wrong: should be 70.00
          createdAt: new Date(),
        })
      ).toThrow('Unbalanced ledger entry');
    });

    it('throws for unbalanced CREDIT entry', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: 'entry-1',
          walletId: 'wallet-1',
          transactionId: 'tx-1',
          direction: LedgerDirection.Credit,
          money: Money.from({ amount: '50.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '99.00', currency: 'BRL' }), // Wrong: should be 100.00
          createdAt: new Date(),
        })
      ).toThrow('Unbalanced ledger entry');
    });
  });

  describe('rehydrate', () => {
    it('reconstructs entry from persisted state', () => {
      const entry = WalletLedgerEntry.rehydrate({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: '30.00',
        currency: 'BRL',
        balanceBefore: '100.00',
        balanceBeforeCurrency: 'BRL',
        balanceAfter: '70.00',
        balanceAfterCurrency: 'BRL',
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(entry.id).toBe('entry-1');
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.amount).toBe('30.00');
      expect(entry.balanceBefore.amount).toBe('100.00');
      expect(entry.balanceAfter.amount).toBe('70.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('throws when rehydrating unbalanced entry (data corruption detection)', () => {
      expect(() =>
        WalletLedgerEntry.rehydrate({
          id: 'entry-1',
          walletId: 'wallet-1',
          transactionId: 'tx-1',
          direction: LedgerDirection.Debit,
          money: '30.00',
          currency: 'BRL',
          balanceBefore: '100.00',
          balanceBeforeCurrency: 'BRL',
          balanceAfter: '69.00', // Corrupted: should be 70.00
          balanceAfterCurrency: 'BRL',
          createdAt: new Date(),
        })
      ).toThrow();
    });
  });

  describe('isBalanced', () => {
    it('returns true for balanced entry', () => {
      const entry = WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '30.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
        createdAt: new Date(),
      });

      expect(entry.isBalanced()).toBe(true);
    });

    it('returns true for balanced CREDIT entry', () => {
      const entry = WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
        createdAt: new Date(),
      });

      expect(entry.isBalanced()).toBe(true);
    });
  });
});