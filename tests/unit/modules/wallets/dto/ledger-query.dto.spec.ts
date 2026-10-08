import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LedgerQueryDto } from '../../../../../src/modules/wallets/dto/ledger-query.dto';

async function validateQuery(query: Record<string, unknown>) {
  const dto = plainToInstance(LedgerQueryDto, query);
  const errors = await validate(dto);
  return { dto: dto as LedgerQueryDto, errors };
}

describe('LedgerQueryDto', () => {
  it('accepts an empty query and defaults limit to 50', async () => {
    const { dto, errors } = await validateQuery({});
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.cursor).toBeUndefined();
  });

  it('accepts a numeric string limit within bounds', async () => {
    const { dto, errors } = await validateQuery({ limit: '100' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(100);
  });

  it('accepts limit=1', async () => {
    const { errors } = await validateQuery({ limit: '1' });
    expect(errors).toHaveLength(0);
  });

  it('rejects limit=101', async () => {
    const { errors } = await validateQuery({ limit: '101' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects limit=0', async () => {
    const { errors } = await validateQuery({ limit: '0' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative limit', async () => {
    const { errors } = await validateQuery({ limit: '-1' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-numeric limit', async () => {
    const { errors } = await validateQuery({ limit: 'abc' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('keeps cursor as an opaque string (validated by the codec later)', async () => {
    const { dto, errors } = await validateQuery({ cursor: 'garbage-cursor' });
    expect(errors).toHaveLength(0);
    expect(dto.cursor).toBe('garbage-cursor');
  });
});
