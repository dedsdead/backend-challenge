import { describe, it, expect } from 'bun:test';
import { validate } from 'class-validator';
import { MoneyDto } from '../../../../src/common/dto/money.dto';

function dtoLike(props: Record<string, unknown>): MoneyDto {
  const dto = new MoneyDto();
  Object.assign(dto, props);
  return dto;
}

describe('MoneyDto', () => {
  it('accepts a valid amount and currency', async () => {
    const errors = await validate(dtoLike({ amount: '1000.00', currency: 'BRL' }));
    expect(errors).toHaveLength(0);
  });

  it('accepts zero', async () => {
    const errors = await validate(dtoLike({ amount: '0.00', currency: 'USD' }));
    expect(errors).toHaveLength(0);
  });

  it('accepts up to 15 integer digits', async () => {
    const errors = await validate(dtoLike({ amount: '999999999999999.00', currency: 'BRL' }));
    expect(errors).toHaveLength(0);
  });

  it('rejects integer-only amount', async () => {
    const errors = await validate(dtoLike({ amount: '100', currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects one decimal place', async () => {
    const errors = await validate(dtoLike({ amount: '100.5', currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects three decimal places', async () => {
    const errors = await validate(dtoLike({ amount: '100.000', currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative amount', async () => {
    const errors = await validate(dtoLike({ amount: '-5.00', currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects 16 integer digits', async () => {
    const errors = await validate(dtoLike({ amount: '1234567890123456.00', currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing amount', async () => {
    const errors = await validate(dtoLike({ currency: 'BRL' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects lowercase currency', async () => {
    const errors = await validate(dtoLike({ amount: '10.00', currency: 'brl' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects too-long currency', async () => {
    const errors = await validate(dtoLike({ amount: '10.00', currency: 'BRLX' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing currency', async () => {
    const errors = await validate(dtoLike({ amount: '10.00' }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
