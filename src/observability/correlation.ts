import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Client-supplied correlation ids are echoed back — accept only a short,
 * header-safe token so a malicious value cannot shape the response (same rule
 * as the exception filter's `x-correlation-id` handling). */
export const CORRELATION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const storage = new AsyncLocalStorage<{ correlationId: string }>();

/** Correlation id of the request being handled, if any (plan T045). */
export const getCorrelationId = (): string | undefined =>
  storage.getStore()?.correlationId;

/** Runs `fn` under an explicit correlation id (workers, tests). */
export const runWithCorrelationId = <T>(correlationId: string, fn: () => T): T =>
  storage.run({ correlationId }, fn);

/**
 * Express middleware: validates/assigns `x-correlation-id`, stores it in
 * AsyncLocalStorage for the whole request scope and echoes it back on the
 * response (plan T045).
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound: unknown = req.headers?.['x-correlation-id'];
  const correlationId =
    typeof inbound === 'string' && CORRELATION_ID_RE.test(inbound)
      ? inbound
      : randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  storage.run({ correlationId }, () => next());
}
