import { describe, it, expect } from 'bun:test';
import { WalletLedgerEntry } from '../../../../../src/domain/ledger/wallet-ledger-entry';
import { LedgerDirection } from '../../../../../src/domain/enums';
import { Money } from '../../../../../src/domain/money/money';
import type { LedgerPage } from '../../../../../src/database/repositories/interfaces';
import { LedgerPageResponseDto } from '../../../../../src/modules/wallets/dto/ledger-page-response.dto';

const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const TX_ID = '0192f298-345e-7e38-af88-e43f851a819d';
const AT = new Date('2026-10-07T12:00:00.000Z');

function entry(props: { id: string; createdAt: Date; balanceBefore: string; balanceAfter: string }) {
  return WalletLedgerEntry.create({
    walletId: WALLET_ID,
    transactionId: TX_ID,
    direction: LedgerDirection.Credit,
    money: Money.from({ amount: '100.00', currency: 'BRL' }),
    balanceBefore: Money.from({ amount: props.balanceBefore, currency: 'BRL' }),
    balanceAfter: Money.from({ amount: props.balanceAfter, currency: 'BRL' }),
    createdAt: props.createdAt,
    id: props.id,
  });
}

describe('LedgerPageResponseDto', () => {
  it('maps entries to the documented field set', () => {
    const page: LedgerPage = {
      entries: [
        entry({
          id: '0192f291-27dd-7d3f-8071-5f8685deef01',
          createdAt: AT,
          balanceBefore: '0.00',
          balanceAfter: '100.00',
        }),
      ],
      nextCursor: null,
    };
    const response = LedgerPageResponseDto.from(page);
    expect(response.entries).toHaveLength(1);
    expect(response.entries[0]).toEqual({
      id: '0192f291-27dd-7d3f-8071-5f8685deef01',
      transactionId: TX_ID,
      direction: 'CREDIT',
      amount: '100.00',
      balanceBefore: { amount: '0.00', currency: 'BRL' },
      balanceAfter: { amount: '100.00', currency: 'BRL' },
      createdAt: AT.toISOString(),
    });
    expect(response.nextCursor).toBeNull();
  });

  it('encodes nextCursor as an opaque string when more pages exist', () => {
    const page: LedgerPage = {
      entries: [
        entry({
          id: '0192f291-27dd-7d3f-8071-5f8685deef01',
          createdAt: AT,
          balanceBefore: '0.00',
          balanceAfter: '100.00',
        }),
      ],
      nextCursor: { createdAt: AT, id: '0192f291-27dd-7d3f-8071-5f8685deef01' },
    };
    const response = LedgerPageResponseDto.from(page);
    expect(typeof response.nextCursor).toBe('string');
    expect(response.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns an empty page shape for a wallet with no entries', () => {
    const response = LedgerPageResponseDto.from({ entries: [], nextCursor: null });
    expect(response).toEqual({ entries: [], nextCursor: null });
  });
});
