import { describe, it, expect } from 'bun:test';
import {
  DomainError,
  ValidationError,
  InsufficientFundsError,
  CurrencyMismatchError,
  InvalidTransactionStateError,
  ReferenceResolutionError,
  IdempotencyConflictError,
  WalletExistsError,
  NotFoundError,
} from '../../../src/domain/errors';
import { FailureCode } from '../../../src/domain/failure-codes';

describe('Domain Errors', () => {
  describe('DomainError', () => {
    it('creates error with message', () => {
      const error = new DomainError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('DomainError');
      expect(error.failureCode).toBeUndefined();
    });

    it('creates error with failure code', () => {
      const error = new DomainError('Test error', FailureCode.ValidationFailed);
      expect(error.message).toBe('Test error');
      expect(error.failureCode).toBe(FailureCode.ValidationFailed);
    });
  });

  describe('ValidationError', () => {
    it('extends DomainError', () => {
      const error = new ValidationError('Invalid input');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('ValidationError');
      expect(error.failureCode).toBe(FailureCode.ValidationFailed);
    });
  });

  describe('InsufficientFundsError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new InsufficientFundsError('Not enough funds');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('InsufficientFundsError');
      expect(error.failureCode).toBe(FailureCode.InsufficientFunds);
    });
  });

  describe('CurrencyMismatchError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new CurrencyMismatchError('Currency mismatch');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('CurrencyMismatchError');
      expect(error.failureCode).toBe(FailureCode.CurrencyMismatch);
    });
  });

  describe('InvalidTransactionStateError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new InvalidTransactionStateError('Invalid state');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('InvalidTransactionStateError');
      expect(error.failureCode).toBe(FailureCode.ValidationFailed);
    });
  });

  describe('ReferenceResolutionError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new ReferenceResolutionError('Reference not found');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('ReferenceResolutionError');
      expect(error.failureCode).toBe(FailureCode.ReferenceNotFound);
    });
  });

  describe('IdempotencyConflictError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new IdempotencyConflictError('Idempotency conflict');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('IdempotencyConflictError');
      expect(error.failureCode).toBe(FailureCode.IdempotencyConflict);
    });
  });

  describe('WalletExistsError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new WalletExistsError('Wallet exists');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('WalletExistsError');
      expect(error.failureCode).toBe(FailureCode.WalletExists);
    });
  });

  describe('NotFoundError', () => {
    it('extends DomainError with correct failure code', () => {
      const error = new NotFoundError('Not found');
      expect(error).toBeInstanceOf(DomainError);
      expect(error.name).toBe('NotFoundError');
      expect(error.failureCode).toBe(FailureCode.WalletNotFound);
    });
  });
});