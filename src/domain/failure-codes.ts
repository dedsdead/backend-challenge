export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalExceedsBalance = 'REVERSAL_EXCEEDS_BALANCE',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  WalletNotFound = 'WALLET_NOT_FOUND',
  ValidationFailed = 'VALIDATION_FAILED',
  IdempotencyConflict = 'IDEMPOTENCY_CONFLICT',
  WalletExists = 'WALLET_EXISTS',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  InternalError = 'INTERNAL_ERROR',
}

export const FAILURE_CODE_DESCRIPTIONS: Record<FailureCode, string> = {
  [FailureCode.InsufficientFunds]: 'Insufficient funds to complete the transaction',
  [FailureCode.ReversalExceedsBalance]: 'Reversal amount exceeds current balance',
  [FailureCode.ReferenceNotFound]: 'Referenced transaction not found',
  [FailureCode.CurrencyMismatch]: 'Transaction currency does not match wallet currency',
  [FailureCode.WalletNotFound]: 'Wallet not found',
  [FailureCode.ValidationFailed]: 'Transaction validation failed',
  [FailureCode.IdempotencyConflict]: 'Idempotency key conflict - different payload',
  [FailureCode.WalletExists]: 'Wallet already exists for this player and currency',
  [FailureCode.ReferenceAlreadyReversed]: 'Reference transaction already reversed by this operation type',
  [FailureCode.InternalError]: 'Internal system error',
};