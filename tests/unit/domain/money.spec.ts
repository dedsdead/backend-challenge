import { describe, it, expect, beforeEach } from 'bun:test';
import { Money } from '../../../src/domain/money/money';

describe('Money', () => {
  describe('from', () => {
    it('creates Money from valid amount string', () => {
      const money = Money.from({ amount: '10.00', currency: 'BRL' });
      expect(money.amount).toBe('10.00');
      expect(money.currency).toBe('BRL');
    });

    it('creates Money from integer string', () => {
      const money = Money.from({ amount: '10', currency: 'BRL' });
      expect(money.amount).toBe('10.00');
    });

    it('creates Money from single decimal place', () => {
      const money = Money.from({ amount: '10.5', currency: 'BRL' });
      expect(money.amount).toBe('10.50');
    });

    it('throws for NaN', () => {
      expect(() => Money.from({ amount: 'NaN', currency: 'BRL' })).toThrow();
    });

    it('throws for Infinity', () => {
      expect(() => Money.from({ amount: 'Infinity', currency: 'BRL' })).toThrow();
    });

    it('throws for scientific notation', () => {
      expect(() => Money.from({ amount: '1e2', currency: 'BRL' })).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow();
    });

    it('rounds to 2 decimal places using half-up rounding', () => {
      // 10.001 -> 10.00 (rounds down)
      const m1 = Money.from({ amount: '10.001', currency: 'BRL' });
      expect(m1.amount).toBe('10.00');

      // 10.005 -> 10.01 (half-up rounding: 5 rounds up)
      const m2 = Money.from({ amount: '10.005', currency: 'BRL' });
      expect(m2.amount).toBe('10.01');

      // 10.015 -> 10.02 (half-up rounding)
      const m3 = Money.from({ amount: '10.015', currency: 'BRL' });
      expect(m3.amount).toBe('10.02');
    });

    it('throws for negative amount when contract disallows', () => {
      expect(() => Money.from({ amount: '-10.00', currency: 'BRL' })).toThrow();
    });

    it('allows negative amounts via internal factory', () => {
      // negate() should return a valid negative Money
      const m = Money.from({ amount: '10.00', currency: 'BRL' });
      const negated = m.negate();
      expect(negated.amount).toBe('-10.00');
      expect(negated.isNegative()).toBe(true);
    });
  });

  describe('zero', () => {
    it('creates zero money for any currency', () => {
      const money = Money.zero('BRL');
      expect(money.amount).toBe('0.00');
      expect(money.currency).toBe('BRL');
      expect(money.isZero()).toBe(true);
    });
  });

  describe('arithmetic operations', () => {
    it('adds two Money instances', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m2 = Money.from({ amount: '5.00', currency: 'BRL' });
      const result = m1.add(m2);
      expect(result.amount).toBe('15.00');
    });

    it('subtracts two Money instances', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m2 = Money.from({ amount: '5.00', currency: 'BRL' });
      const result = m1.subtract(m2);
      expect(result.amount).toBe('5.00');
    });

    it('negates Money', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const result = m1.negate();
      expect(result.amount).toBe('-10.00');
    });

    it('throws when adding different currencies', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m2 = Money.from({ amount: '5.00', currency: 'USD' });
      expect(() => m1.add(m2)).toThrow('Currency mismatch');
    });
  });

  describe('comparison operations', () => {
    it('isZero returns true for zero', () => {
      const m = Money.from({ amount: '0.00', currency: 'BRL' });
      expect(m.isZero()).toBe(true);
    });

    it('isPositive returns true for positive', () => {
      const m = Money.from({ amount: '10.00', currency: 'BRL' });
      expect(m.isPositive()).toBe(true);
    });

    it('isNegative returns true for negative', () => {
      const m = Money.from({ amount: '10.00', currency: 'BRL' }).negate();
      expect(m.isNegative()).toBe(true);
    });

    it('isLessThan works correctly', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m2 = Money.from({ amount: '20.00', currency: 'BRL' });
      expect(m1.isLessThan(m2)).toBe(true);
      expect(m2.isLessThan(m1)).toBe(false);
    });

    it('equals works correctly', () => {
      const m1 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m2 = Money.from({ amount: '10.00', currency: 'BRL' });
      const m3 = Money.from({ amount: '20.00', currency: 'BRL' });
      expect(m1.equals(m2)).toBe(true);
      expect(m1.equals(m3)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('returns MoneyProps', () => {
      const m = Money.from({ amount: '10.50', currency: 'BRL' });
      expect(m.toJSON()).toEqual({ amount: '10.50', currency: 'BRL' });
    });
  });

  describe('toString', () => {
    it('returns formatted string', () => {
      const m = Money.from({ amount: '10.50', currency: 'BRL' });
      expect(m.toString()).toBe('10.50 BRL');
    });
  });
});