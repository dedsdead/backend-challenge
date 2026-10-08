import type { WagerTransaction } from '../../../domain/wager-transaction/wager-transaction';
import { WagerTransactionStatus } from '../../../domain/enums';

/**
 * Lookup body (AC-28/G4): `failureCode` present iff REJECTED; `balance` is the
 * result-balance snapshot for PROCESSED/REJECTED and absent for
 * PENDING_REFERENCE — enough to poll a pending outcome without resubmitting.
 */
export class TransactionResponseDto {
  transactionId!: string;
  externalTransactionId!: string;
  kind!: string;
  status!: string;
  failureCode?: string;
  balance?: { amount: string; currency: string };

  static from(tx: WagerTransaction): TransactionResponseDto {
    const dto = new TransactionResponseDto();
    dto.transactionId = tx.id;
    dto.externalTransactionId = tx.externalTransactionId;
    dto.kind = tx.kind;
    dto.status = tx.status;
    if (tx.status === WagerTransactionStatus.Rejected) {
      if (tx.failureCode) dto.failureCode = tx.failureCode;
    }
    if (
      tx.status === WagerTransactionStatus.Processed ||
      tx.status === WagerTransactionStatus.Rejected
    ) {
      const balance = tx.resultBalance;
      if (balance) dto.balance = balance.toJSON();
    }
    return dto;
  }
}
