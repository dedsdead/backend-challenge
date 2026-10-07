import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  public readonly amount: string;
  public readonly currency: string;

  private constructor(amount: string, currency: string) {
    this.amount = amount;
    this.currency = currency;
  }

  static from(props: MoneyProps): Money {
    let amountStr: string;

    try {
      amountStr = props.amount.trim();
    } catch {
      throw new Error(`Invalid Money amount: ${props.amount}`);
    }

    if (amountStr === '') {
      throw new Error(`Invalid Money amount: ${props.amount} (empty string)`);
    }

    // Reject scientific notation
    if (/[eE]/.test(amountStr)) {
      throw new Error(`Invalid Money amount: ${props.amount} (scientific notation not allowed)`);
    }

    const amount = new Decimal(amountStr);

    if (amount.isNaN() || !amount.isFinite()) {
      throw new Error(`Invalid Money amount: ${props.amount} (NaN or Infinity)`);
    }

    // Reject negative amounts in entry contracts
    if (amount.isNegative()) {
      throw new Error(`Invalid Money amount: ${props.amount} (negative not allowed in entry contracts)`);
    }

    // Round to exactly 2 decimal places using Decimal.js toFixed (banker's rounding)
    amountStr = amount.toFixed(2);

    return new Money(amountStr, props.currency);
  }

  static zero(currency: string): Money {
    return new Money('0.00', currency);
  }

  // Internal factory for creating Money from already-validated values (allows negative)
  static fromInternal(amount: string, currency: string): Money {
    const amountObj = new Decimal(amount);
    if (amountObj.isNaN() || !amountObj.isFinite()) {
      throw new Error(`Invalid Money amount: ${amount} (NaN or Infinity)`);
    }
    // Round to exactly 2 decimal places
    const amountStr = amountObj.toFixed(2);
    return new Money(amountStr, currency);
  }

  private getValue(): Decimal {
    return new Decimal(this.amount);
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} !== ${other.currency}`);
    }
    const result = this.getValue().plus(other.getValue());
    return new Money(result.toFixed(2), this.currency);
  }

  subtract(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} !== ${other.currency}`);
    }
    const result = this.getValue().minus(other.getValue());
    return new Money(result.toFixed(2), this.currency);
  }

  negate(): Money {
    const result = (-this.getValue()).toFixed(2);
    // Allow negative results from negate
    return new Money(result, this.currency);
  }

  isZero(): boolean {
    return this.getValue().isZero();
  }

  isPositive(): boolean {
    return this.getValue().isPositive();
  }

  isNegative(): boolean {
    return this.getValue().isNegative();
  }

  isLessThan(other: Money): boolean {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} !== ${other.currency}`);
    }
    return this.getValue().lt(other.getValue());
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} !== ${other.currency}`);
    }
    return this.getValue().equals(other.getValue());
  }

  toJSON(): MoneyProps {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }
}