import { describe, expect, it, mock } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { HealthService, type SqsProber } from '../../../src/health/health.service';

function makeService(
  execute: (sql: string) => Promise<unknown>,
  prober?: Partial<SqsProber>,
) {
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager;
  const sqs: SqsProber = {
    probe: prober?.probe ?? (() => Promise.resolve()),
  };
  return new HealthService(em, sqs);
}

describe('HealthService', () => {
  it('live returns process-only status ok', () => {
    const service = makeService(mock(() => Promise.resolve([])));
    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('ready runs SELECT 1, probes SQS and reports postgres + sqs ok', async () => {
    const execute = mock(() => Promise.resolve([{ '?column?': 1 }]));
    const probe = mock(() => Promise.resolve());
    const service = makeService(execute, { probe });
    await expect(service.ready()).resolves.toEqual({
      postgres: 'ok',
      sqs: 'ok',
    });
    expect(execute).toHaveBeenCalledWith('SELECT 1');
    expect(probe).toHaveBeenCalledTimes(1);
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

  it('ready throws ServiceUnavailableException (503) when the SQS probe fails', async () => {
    const service = makeService(mock(() => Promise.resolve([])), {
      probe: () => Promise.reject(new Error('queue down')),
    });
    const error = await service.ready().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    if (!(error instanceof ServiceUnavailableException)) {
      throw new Error('expected a ServiceUnavailableException');
    }
    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe('SQS unreachable');
    expect(error.cause).toBeInstanceOf(Error);
  });
});
