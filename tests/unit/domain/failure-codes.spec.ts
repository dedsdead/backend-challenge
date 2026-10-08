import { describe, it, expect } from 'bun:test';
import { FailureCode, FAILURE_CODE_DESCRIPTIONS } from '../../../src/domain/failure-codes';

describe('FailureCode', () => {
  it('has all required failure codes', () => {
    expect(String(FailureCode.InsufficientFunds)).toBe('INSUFFICIENT_FUNDS');
    expect(String(FailureCode.ReversalExceedsBalance)).toBe('REVERSAL_EXCEEDS_BALANCE');
    expect(String(FailureCode.ReferenceNotFound)).toBe('REFERENCE_NOT_FOUND');
    expect(String(FailureCode.ReferenceAmountMismatch)).toBe('REFERENCE_AMOUNT_MISMATCH');
    expect(String(FailureCode.ReferenceNotProcessed)).toBe('REFERENCE_NOT_PROCESSED');
    expect(String(FailureCode.CurrencyMismatch)).toBe('CURRENCY_MISMATCH');
    expect(String(FailureCode.WalletNotFound)).toBe('WALLET_NOT_FOUND');
    expect(String(FailureCode.ValidationFailed)).toBe('VALIDATION_FAILED');
    expect(String(FailureCode.IdempotencyConflict)).toBe('IDEMPOTENCY_CONFLICT');
    expect(String(FailureCode.WalletExists)).toBe('WALLET_EXISTS');
    expect(String(FailureCode.ReferenceAlreadyReversed)).toBe('REFERENCE_ALREADY_REVERSED');
    expect(String(FailureCode.InternalError)).toBe('INTERNAL_ERROR');
    expect(String(FailureCode.ReferenceMismatch)).toBe('REFERENCE_MISMATCH');
    expect(String(FailureCode.ReferenceInvalidKind)).toBe('REFERENCE_INVALID_KIND');
    expect(String(FailureCode.InfrastructureError)).toBe('INFRASTRUCTURE_ERROR');
  });

  it('has exactly 15 failure codes', () => {
    expect(Object.values(FailureCode)).toHaveLength(15);
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
        FailureCode.ReferenceMismatch,
        FailureCode.ReferenceInvalidKind,
        FailureCode.InfrastructureError,
      ];
      for (const code of codes) {
        expect(FAILURE_CODE_DESCRIPTIONS[code]).toBeDefined();
        expect(typeof FAILURE_CODE_DESCRIPTIONS[code]).toBe('string');
        expect(FAILURE_CODE_DESCRIPTIONS[code].length).toBeGreaterThan(0);
      }
    });

    it('covers every enum member', () => {
      for (const code of Object.values(FailureCode)) {
        expect(FAILURE_CODE_DESCRIPTIONS[code]).toBeDefined();
      }
    });
  });
});