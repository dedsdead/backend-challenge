import { describe, expect, it } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import {
  correlationIdMiddleware,
  getCorrelationId,
} from '../../../src/observability/correlation';

const makeRes = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
  };
};

const run = (req: Partial<Request>) => {
  const res = makeRes();
  let seen: string | undefined;
  let called = 0;
  correlationIdMiddleware(
    req as Request,
    res as unknown as Response,
    (() => {
      called += 1;
      seen = getCorrelationId();
    }) as NextFunction,
  );
  return { res, seen, called };
};

describe('correlationId middleware (plan T045)', () => {
  it('honors a valid inbound x-correlation-id and echoes it back', () => {
    const { res, seen, called } = run({ headers: { 'x-correlation-id': 'abc-123._' } });
    expect(called).toBe(1);
    expect(seen).toBe('abc-123._');
    expect(res.headers['x-correlation-id']).toBe('abc-123._');
  });

  it('rejects an oversized or malformed inbound id and generates a uuid', () => {
    const { res, seen } = run({
      headers: { 'x-correlation-id': 'x'.repeat(200) },
    });
    expect(seen).not.toBe('x'.repeat(200));
    expect(seen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.headers['x-correlation-id']).toBe(seen);
  });

  it('generates a uuid when no header is present', () => {
    const { res, seen, called } = run({ headers: {} });
    expect(called).toBe(1);
    expect(seen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.headers['x-correlation-id']).toBe(seen);
  });

  it('exposes no correlation id outside the middleware scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });
});
