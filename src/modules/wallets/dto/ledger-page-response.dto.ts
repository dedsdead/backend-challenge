import type { LedgerPage } from '../../../database/repositories/interfaces';
import { encodeLedgerCursor } from '../ledger-cursor.codec';

export class LedgerEntryResponseDto {
  id!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  balanceBefore!: { amount: string; currency: string };
  balanceAfter!: { amount: string; currency: string };
  createdAt!: string;
}

export class LedgerPageResponseDto {
  entries!: LedgerEntryResponseDto[];
  nextCursor!: string | null;

  static from(page: LedgerPage): LedgerPageResponseDto {
    const dto = new LedgerPageResponseDto();
    dto.entries = page.entries.map((entry) => {
      const item = new LedgerEntryResponseDto();
      item.id = entry.id;
      item.transactionId = entry.transactionId;
      item.direction = entry.direction;
      item.amount = entry.money.amount;
      item.balanceBefore = entry.balanceBefore.toJSON();
      item.balanceAfter = entry.balanceAfter.toJSON();
      item.createdAt = entry.createdAt.toISOString();
      return item;
    });
    dto.nextCursor = page.nextCursor ? encodeLedgerCursor(page.nextCursor) : null;
    return dto;
  }
}
