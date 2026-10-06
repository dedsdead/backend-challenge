import { describe, expect, it, mock } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { HealthService } from '../../../src/health/health.service';

function makeService(execute: (sql: string) => Promise<unknown>) {
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager;
  return new HealthService(em);
}

describe('HealthService', () => {
  it('live returns process-only status ok', () => {
    const service = makeService(mock(() => Promise.resolve([])));
    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('ready runs SELECT 1 and reports postgres ok', async () => {
    const execute = mock(() => Promise.resolve([{ '?column?': 1 }]));
    const service = makeService(execute);
    await expect(service.ready()).resolves.toEqual({ postgres: 'ok' });
    expect(execute).toHaveBeenCalledWith('SELECT 1');
  });

  it('ready throws ServiceUnavailableException (503) when the DB fails', async () => {
    const service = makeService(mock(() => Promise.reject(new Error('down'))));
    const error = await service.ready().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    if (!(error instanceof ServiceUnavailableException)) {
      throw new Error('expected a ServiceUnavailableException');
    }
    expect(error.getStatus()).toBe(503);
    expect(error.cause).toBeInstanceOf(Error);
    if (!(error.cause instanceof Error)) {
      throw new Error('expected the cause to be an Error');
    }
    expect(error.cause.message).toBe('down');
  });
});
