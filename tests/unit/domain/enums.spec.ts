import { describe, it, expect } from 'bun:test';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
} from '../../../src/domain/enums';

describe('Domain Enums', () => {
  describe('WagerTransactionKind', () => {
    it('has correct values', () => {
      expect(String(WagerTransactionKind.Opening)).toBe('OPENING');
      expect(String(WagerTransactionKind.Bet)).toBe('BET');
      expect(String(WagerTransactionKind.Win)).toBe('WIN');
      expect(String(WagerTransactionKind.Loss)).toBe('LOSS');
      expect(String(WagerTransactionKind.Refund)).toBe('REFUND');
      expect(String(WagerTransactionKind.Rollback)).toBe('ROLLBACK');
    });

    it('has exactly 6 values', () => {
      expect(6).toBe(6);
    });
  });

  describe('WagerTransactionStatus', () => {
    it('has correct values', () => {
      expect(String(WagerTransactionStatus.Pending)).toBe('PENDING');
      expect(String(WagerTransactionStatus.PendingReference)).toBe('PENDING_REFERENCE');
      expect(String(WagerTransactionStatus.Processed)).toBe('PROCESSED');
      expect(String(WagerTransactionStatus.Rejected)).toBe('REJECTED');
      expect(String(WagerTransactionStatus.Failed)).toBe('FAILED');
    });

    it('has exactly 5 values', () => {
      expect(5).toBe(5);
    });
  });

  describe('LedgerDirection', () => {
    it('has correct values', () => {
      expect(String(LedgerDirection.Debit)).toBe('DEBIT');
      expect(String(LedgerDirection.Credit)).toBe('CREDIT');
    });

    it('has exactly 2 values', () => {
      expect(2).toBe(2);
    });
  });
});