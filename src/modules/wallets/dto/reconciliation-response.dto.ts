import { MoneyDto } from '../../../common/dto/money.dto';

/** Signed money for reconciliation difference (can be negative). */
export class SignedMoneyDto {
  amount!: string;

  currency!: string;
}

/**
 * Reconciliation result (spec §9). `difference = storedBalance − calculatedBalance`
 * as a signed decimal string: positive means the stored balance exceeds the ledger
 * sum, negative means the ledger sum exceeds the stored balance. Divergence is
 * reported, never fixed (AC-17/AC-17a).
 */
export class ReconciliationResponseDto {
  walletId!: string;

  storedBalance!: MoneyDto;

  calculatedBalance!: MoneyDto;

  difference!: SignedMoneyDto;

  consistent!: boolean;

  checkedEntries!: number;
}