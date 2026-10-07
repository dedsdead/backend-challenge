import { FailureCode } from './failure-codes';

export class DomainError extends Error {
  public readonly failureCode?: FailureCode;

  constructor(message: string, failureCode?: FailureCode) {
    super(message);
    this.name = 'DomainError';
    this.failureCode = failureCode;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.ValidationFailed);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.InsufficientFunds);
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.CurrencyMismatch);
    this.name = 'CurrencyMismatchError';
    Object.setPrototypeOf(this, CurrencyMismatchError.prototype);
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.ValidationFailed);
    this.name = 'InvalidTransactionStateError';
    Object.setPrototypeOf(this, InvalidTransactionStateError.prototype);
  }
}

export class ReferenceResolutionError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.ReferenceNotFound);
    this.name = 'ReferenceResolutionError';
    Object.setPrototypeOf(this, ReferenceResolutionError.prototype);
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.IdempotencyConflict);
    this.name = 'IdempotencyConflictError';
    Object.setPrototypeOf(this, IdempotencyConflictError.prototype);
  }
}

export class WalletExistsError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.WalletExists);
    this.name = 'WalletExistsError';
    Object.setPrototypeOf(this, WalletExistsError.prototype);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, FailureCode.WalletNotFound);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}