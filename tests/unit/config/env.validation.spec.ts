import { describe, expect, it } from 'bun:test';
import { validateEnv } from '../../../src/config/env.validation';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/wagering',
  SQS_QUEUE_URL: 'http://localhost:4566/000000000000/wager-transactions.fifo',
  SQS_DLQ_URL: 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/wagering',
  KEYCLOAK_AUDIENCE: 'wagering-api',
};

describe('validateEnv', () => {
  it('accepts a complete env and applies defaults', () => {
    const env = validateEnv({ ...baseEnv });
    expect(env.SQS_ENDPOINT).toBe('http://localhost:4566');
    expect(env.PORT).toBe(3000);
    expect(env.WORKERS_ENABLED).toBe(true);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = baseEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => validateEnv({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('coerces WORKERS_ENABLED=false to boolean false', () => {
    const env = validateEnv({ ...baseEnv, WORKERS_ENABLED: 'false' });
    expect(env.WORKERS_ENABLED).toBe(false);
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects an empty PORT', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: '' })).toThrow(/PORT/);
  });

  it('rejects PORT out of range', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: 0 })).toThrow(/PORT/);
    expect(() => validateEnv({ ...baseEnv, PORT: 99999 })).toThrow(/PORT/);
  });

  it('rejects a non-integer PORT', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: 3000.5 })).toThrow(/PORT/);
  });

  it('accepts PORT boundary values', () => {
    expect(validateEnv({ ...baseEnv, PORT: 1 }).PORT).toBe(1);
    expect(validateEnv({ ...baseEnv, PORT: 65535 }).PORT).toBe(65535);
  });

  it('rejects WORKERS_ENABLED values other than true/false', () => {
    expect(() => validateEnv({ ...baseEnv, WORKERS_ENABLED: 'yes' })).toThrow(
      /WORKERS_ENABLED/,
    );
  });

  it('defaults HOST to loopback and rejects other hosts', () => {
    expect(validateEnv({ ...baseEnv }).HOST).toBe('127.0.0.1');
    expect(validateEnv({ ...baseEnv, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
    expect(() => validateEnv({ ...baseEnv, HOST: '10.0.0.5' })).toThrow(/HOST/);
  });

  it('rejects a DATABASE_URL without a postgres scheme', () => {
    expect(() =>
      validateEnv({ ...baseEnv, DATABASE_URL: 'http://localhost:5432/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('accepts postgresql:// in any case and rejects scheme-only URLs', () => {
    const url = 'postgresql://user:pass@localhost:5432/wagering';
    expect(validateEnv({ ...baseEnv, DATABASE_URL: url }).DATABASE_URL).toBe(
      url,
    );
    expect(
      validateEnv({ ...baseEnv, DATABASE_URL: 'POSTGRES://user@localhost/db' })
        .DATABASE_URL,
    ).toBe('POSTGRES://user@localhost/db');
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: 'postgres://' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects empty or unsupported HOST values', () => {
    expect(() => validateEnv({ ...baseEnv, HOST: '' })).toThrow(/HOST/);
    expect(() => validateEnv({ ...baseEnv, HOST: 'localhost' })).toThrow(/HOST/);
    expect(() => validateEnv({ ...baseEnv, HOST: '::' })).toThrow(/HOST/);
  });
});
