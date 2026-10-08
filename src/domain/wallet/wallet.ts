import { Money } from '../money/money';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import { LedgerDirection } from '../enums';
import { InsufficientFundsError, CurrencyMismatchError } from '../errors';

export interface WalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerMovement {
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export interface WalletDebitResult {
  wallet: Wallet;
  movement: LedgerMovement;
}

export interface WalletCreditResult {
  wallet: Wallet;
  movement: LedgerMovement;
}

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  public readonly balance: Money;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(
    id: string,
    playerId: string,
    currency: string,
    balance: Money,
    version: number,
    createdAt: Date,
    updatedAt: Date
  ) {
    this.id = id;
    this.playerId = playerId;
    this.currency = currency;
    this.balance = balance;
    this.version = version;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static open(props: WalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new Error('Initial balance cannot be negative');
    }

    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from({ amount: state.balance, currency: state.currency }),
      state.version,
      state.createdAt,
      state.updatedAt
    );
  }

  private withUpdatedState(balance: Money, version: number, updatedAt: Date): Wallet {
    return new Wallet(
      this.id,
      this.playerId,
      this.currency,
      balance,
      version,
      this.createdAt,
      updatedAt
    );
  }

  debit(money: Money, at: Date): { movement: LedgerMovement; wallet: Wallet } {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(`Currency mismatch: ${this.currency} !== ${money.currency}`);
    }

    const balanceBefore = this.balance;
    const balanceAfter = balanceBefore.subtract(money);

    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(`Insufficient funds: ${balanceBefore.amount} - ${money.amount} < 0`);
    }

    const movement: LedgerMovement = {
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
    };

    const newWallet = this.withUpdatedState(balanceAfter, this.version + 1, at);

    return { movement, wallet: newWallet };
  }

  credit(money: Money, at: Date): { movement: LedgerMovement; wallet: Wallet } {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(`Currency mismatch: ${this.currency} !== ${money.currency}`);
    }

    const balanceBefore = this.balance;
    const balanceAfter = balanceBefore.add(money);

    const movement: LedgerMovement = {
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
    };

    const newWallet = this.withUpdatedState(balanceAfter, this.version + 1, at);

    return { movement, wallet: newWallet };
  }
}