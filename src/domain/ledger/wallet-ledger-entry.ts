import { Money } from '../money/money';
import { LedgerDirection } from '../enums';

export interface LedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: string;
  currency: string;
  balanceBefore: string;
  balanceBeforeCurrency: string;
  balanceAfter: string;
  balanceAfterCurrency: string;
  createdAt: Date;
}

export class WalletLedgerEntry {
  public readonly id: string;
  public readonly walletId: string;
  public readonly transactionId: string;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly balanceBefore: Money;
  public readonly balanceAfter: Money;
  public readonly createdAt: Date;

  private constructor(props: LedgerEntryProps) {
    this.id = props.id;
    this.walletId = props.walletId;
    this.transactionId = props.transactionId;
    this.direction = props.direction;
    this.money = props.money;
    this.balanceBefore = props.balanceBefore;
    this.balanceAfter = props.balanceAfter;
    this.createdAt = props.createdAt;
  }

  static create(props: Omit<LedgerEntryProps, 'id'> & { id?: string }): WalletLedgerEntry {
    const id = props.id || crypto.randomUUID();

    // Validate balance arithmetic: balanceBefore ± money === balanceAfter
    let expectedBalanceAfter: Money;
    if (props.direction === LedgerDirection.Debit) {
      expectedBalanceAfter = props.balanceBefore.subtract(props.money);
    } else {
      expectedBalanceAfter = props.balanceBefore.add(props.money);
    }

    if (!expectedBalanceAfter.equals(props.balanceAfter)) {
      throw new Error(
        `Unbalanced ledger entry: ${props.balanceBefore.amount} ${props.direction} ${props.money.amount} !== ${props.balanceAfter.amount}`
      );
    }

    return new WalletLedgerEntry({
      id,
      walletId: props.walletId,
      transactionId: props.transactionId,
      direction: props.direction,
      money: props.money,
      balanceBefore: props.balanceBefore,
      balanceAfter: props.balanceAfter,
      createdAt: props.createdAt,
    });
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    const money = Money.from({ amount: state.money, currency: state.currency });
    const balanceBefore = Money.from({ amount: state.balanceBefore, currency: state.balanceBeforeCurrency });
    const balanceAfter = Money.from({ amount: state.balanceAfter, currency: state.balanceAfterCurrency });

    // Validate balance arithmetic on rehydration to detect data corruption
    let expectedBalanceAfter: Money;
    if (state.direction === LedgerDirection.Debit) {
      expectedBalanceAfter = balanceBefore.subtract(money);
    } else {
      expectedBalanceAfter = balanceBefore.add(money);
    }

    if (!expectedBalanceAfter.equals(balanceAfter)) {
      throw new Error(
        `Unbalanced ledger entry on rehydration: ${state.balanceBefore} ${state.direction} ${state.money} !== ${state.balanceAfter}`
      );
    }

    return new WalletLedgerEntry({
      id: state.id,
      walletId: state.walletId,
      transactionId: state.transactionId,
      direction: state.direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: state.createdAt,
    });
  }

  isBalanced(): boolean {
    let expectedBalanceAfter: Money;
    if (this.direction === LedgerDirection.Debit) {
      expectedBalanceAfter = this.balanceBefore.subtract(this.money);
    } else {
      expectedBalanceAfter = this.balanceBefore.add(this.money);
    }
    return expectedBalanceAfter.equals(this.balanceAfter);
  }
}