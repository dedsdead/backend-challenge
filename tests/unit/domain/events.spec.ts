import { describe, it, expect } from 'bun:test';
import { Money } from '../../../src/domain/money/money';
import { LedgerDirection } from '../../../src/domain/enums';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
} from '../../../src/events';

describe('Integration Events', () => {
  describe('WagerTransactionProcessed', () => {
    it('has correct eventType and version', () => {
      const event = WagerTransactionProcessed.from({
        eventId: 'evt-1',
        aggregateId: 'tx-1',
        correlationId: 'corr-1',
        causationId: 'cause-1',
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '50.00', currency: 'BRL' }),
        walletVersion: 2,
      });

      expect(event.eventType).toBe('WagerTransactionProcessed');
      expect(event.version).toBe(1);
      expect(event.data.transactionId).toBe('tx-1');
      expect(event.data.walletId).toBe('wallet-1');
      expect(event.data.kind).toBe('BET');
      expect(event.data.money).toEqual({ amount: '50.00', currency: 'BRL' });
      expect(event.data.balanceBefore).toEqual({ amount: '100.00', currency: 'BRL' });
      expect(event.data.balanceAfter).toEqual({ amount: '50.00', currency: 'BRL' });
      expect(event.data.walletVersion).toBe(2);
    });
  });

  describe('WagerTransactionRejected', () => {
    it('has correct eventType and version', () => {
      const event = WagerTransactionRejected.from({
        eventId: 'evt-1',
        aggregateId: 'tx-1',
        correlationId: 'corr-1',
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        failureCode: 'INSUFFICIENT_FUNDS',
      });

      expect(event.eventType).toBe('WagerTransactionRejected');
      expect(event.version).toBe(1);
      expect(event.data.failureCode).toBe('INSUFFICIENT_FUNDS');
    });
  });

  describe('WalletBalanceChanged', () => {
    it('has correct eventType and version', () => {
      const event = WalletBalanceChanged.from({
        eventId: 'evt-1',
        aggregateId: 'wallet-1',
        correlationId: 'corr-1',
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
        walletVersion: 2,
      });

      expect(event.eventType).toBe('WalletBalanceChanged');
      expect(event.version).toBe(1);
      expect(String(event.data.direction)).toBe('CREDIT');
    });
  });

  describe('WagerTransactionPendingReference', () => {
    it('has correct eventType and version', () => {
      const event = WagerTransactionPendingReference.from({
        eventId: 'evt-1',
        aggregateId: 'tx-1',
        correlationId: 'corr-1',
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        kind: 'REFUND',
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        referenceExternalTransactionId: 'ext-ref-1',
      });

      expect(event.eventType).toBe('WagerTransactionPendingReference');
      expect(event.version).toBe(1);
      expect(event.data.referenceExternalTransactionId).toBe('ext-ref-1');
    });
  });

  describe('MoneyProps in events', () => {
    it('uses string amounts in event data', () => {
      const event = WagerTransactionProcessed.from({
        eventId: 'evt-1',
        aggregateId: 'tx-1',
        correlationId: 'corr-1',
        occurredAt: new Date(),
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '50.00', currency: 'BRL' }),
        walletVersion: 2,
      });

      const json = event.toJSON();
      expect(typeof json.data.money.amount).toBe('string');
      expect(typeof json.data.balanceBefore.amount).toBe('string');
      expect(typeof json.data.balanceAfter.amount).toBe('string');
      expect(json.data.money.amount).toBe('50.00');
    });
  });
});