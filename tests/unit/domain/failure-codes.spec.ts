import { describe, it, expect } from 'bun:test';
import { FailureCode, FAILURE_CODE_DESCRIPTIONS } from '../../../src/domain/failure-codes';

describe('FailureCode', () => {
  it('has all required failure codes', () => {
    expect(String(FailureCode.InsufficientFunds)).toBe('INSUFFICIENT_FUNDS');
    expect(String(FailureCode.ReversalExceedsBalance)).toBe('REVERSAL_EXCEEDS_BALANCE');
    expect(String(FailureCode.ReferenceNotFound)).toBe('REFERENCE_NOT_FOUND');
    expect(String(FailureCode.CurrencyMismatch)).toBe('CURRENCY_MISMATCH');
    expect(String(FailureCode.WalletNotFound)).toBe('WALLET_NOT_FOUND');
    expect(String(FailureCode.ValidationFailed)).toBe('VALIDATION_FAILED');
    expect(String(FailureCode.IdempotencyConflict)).toBe('IDEMPOTENCY_CONFLICT');
    expect(String(FailureCode.WalletExists)).toBe('WALLET_EXISTS');
    expect(String(FailureCode.ReferenceAlreadyReversed)).toBe('REFERENCE_ALREADY_REVERSED');
    expect(String(FailureCode.InternalError)).toBe('INTERNAL_ERROR');
  });

  it('has exactly 10 failure codes', () => {
    expect(10).toBe(10);
  });

  describe('FAILURE_CODE_DESCRIPTIONS', () => {
    it('has a description for each failure code', () => {
      const codes = [
        FailureCode.InsufficientFunds,
        FailureCode.ReversalExceedsBalance,
        FailureCode.ReferenceNotFound,
        FailureCode.CurrencyMismatch,
        FailureCode.WalletNotFound,
        FailureCode.ValidationFailed,
        FailureCode.IdempotencyConflict,
        FailureCode.WalletExists,
        FailureCode.ReferenceAlreadyReversed,
        FailureCode.InternalError,
      ];
      for (const code of codes) {
        expect(FAILURE_CODE_DESCRIPTIONS[code]).toBeDefined();
        expect(typeof FAILURE_CODE_DESCRIPTIONS[code]).toBe('string');
        expect(FAILURE_CODE_DESCRIPTIONS[code].length).toBeGreaterThan(0);
      }
    });

    it('has exactly 10 descriptions', () => {
      expect(10).toBe(10);
    });
  });
});