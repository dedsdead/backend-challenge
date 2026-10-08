import { describe, expect, it } from 'bun:test';
import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../../../../src/common/http/exception.filter';
import {
  DomainError,
  IdempotencyConflictError,
  InsufficientFundsError,
  NotFoundError,
  ReferenceResolutionError,
  ValidationError,
  WalletExistsError,
} from '../../../../src/domain/errors';
import { FailureCode } from '../../../../src/domain/failure-codes';

interface Captured {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

interface FakeResponse {
  headersSent?: boolean;
  headers?: Record<string, string>;
  status(code: number): FakeResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

interface LoggerSpy {
  errorCalls: unknown[][];
  warnCalls: unknown[][];
  restore(): void;
}

function spyLogger(): LoggerSpy {
  const errorCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const originalError = Logger.prototype.error;
  const originalWarn = Logger.prototype.warn;
  Logger.prototype.error = (...args: unknown[]): void => {
    errorCalls.push(args);
  };
  Logger.prototype.warn = (...args: unknown[]): void => {
    warnCalls.push(args);
  };
  return {
    errorCalls,
    warnCalls,
    restore(): void {
      Logger.prototype.error = originalError;
      Logger.prototype.warn = originalWarn;
    },
  };
}

function run(
  filter: HttpExceptionFilter,
  exception: unknown,
  init?: { headersSent?: boolean; url?: string; headers?: Record<string, string> },
): Captured {
  const captured: Captured = {};
  const response: FakeResponse = {
    headersSent: init?.headersSent,
    headers: {},
    status(code: number): FakeResponse {
      captured.status = code;
      return response;
    },
    json(body: unknown): void {
      captured.json = body;
    },
    setHeader(name: string, value: string): void {
      captured.headers ??= {};
      captured.headers[name] = value;
    },
  };
  const request = {
    method: 'GET',
    url: init?.url ?? '/test',
    headers: init?.headers ?? {},
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return captured;
}

describe('HttpExceptionFilter', () => {
  describe('error contract { statusCode, code, message, ... }', () => {
    it('maps a string response to { statusCode, code, message }', () => {
      const result = run(new HttpExceptionFilter(), new HttpException('Not found', 404));
      expect(result.status).toBe(404);
      expect(result.json).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Not found' });
    });

    it('maps BadRequestException to VALIDATION_ERROR without the legacy error field', () => {
      const result = run(new HttpExceptionFilter(), new BadRequestException('invalid'));
      expect(result.status).toBe(400);
      expect(result.json).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'invalid',
      });
    });

    it('never leaks fields outside the allowlist and masks the 500 message', () => {
      const exception = new HttpException(
        {
          statusCode: 500,
          message: 'Something failed',
          stack: 'Error: secret stack trace',
          details: { sql: 'SELECT * FROM wagers' },
        },
        500,
      );
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.status).toBe(500);
      expect(result.json).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('always derives statusCode from getStatus(), not the body', () => {
      const exception = new HttpException({ statusCode: 418, message: 'teapot' }, 400);
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.status).toBe(400);
      expect(result.json).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'teapot',
      });
    });

    it('ignores the legacy errorCode option (not part of the contract)', () => {
      const exception = new HttpException('boom', 500, { errorCode: 'E_X' });
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.json).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('ignores legacy errorCode on subclass bodies', () => {
      const exception = new BadRequestException('invalid', { errorCode: 'E_VALIDATION' });
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.json).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'invalid',
      });
    });

    it('passes code, failureCode, transactionId, idempotentReplay from a 422 payload', () => {
      const exception = new UnprocessableEntityException({
        statusCode: 422,
        code: 'TRANSACTION_REJECTED',
        message: 'Bet rejected',
        failureCode: 'INSUFFICIENT_FUNDS',
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        idempotentReplay: false,
      });
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.status).toBe(422);
      expect(result.json).toEqual({
        statusCode: 422,
        code: 'TRANSACTION_REJECTED',
        message: 'Bet rejected',
        failureCode: 'INSUFFICIENT_FUNDS',
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        idempotentReplay: false,
      });
    });

    it('passes validation errors[] through with a summary message', () => {
      const exception = new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ property: 'amount', constraints: { matches: 'amount must match ^\\d{1,15}\\.\\d{2}$' } }],
      });
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.json).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: [{ property: 'amount', constraints: { matches: 'amount must match ^\\d{1,15}\\.\\d{2}$' } }],
      });
    });

    it('adds correlationId from the x-correlation-id request header', () => {
      const result = run(
        new HttpExceptionFilter(),
        new HttpException('Not found', 404),
        { headers: { 'x-correlation-id': 'corr-123' } },
      );
      expect(result.json).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Not found',
        correlationId: 'corr-123',
      });
    });

    it('drops a correlationId that is not a short header-safe token', () => {
      const long = 'x'.repeat(129);
      for (const bad of [long, 'bad id', 'a/b', 'semi;colon']) {
        const result = run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { headers: { 'x-correlation-id': bad } },
        );
        expect((result.json as Record<string, unknown>).correlationId).toBeUndefined();
      }
    });

    it('drops errors[] when masking a 500 HttpException body', () => {
      const exception = new HttpException(
        { statusCode: 500, message: 'boom', errors: [{ property: 'sql' }] },
        500,
      );
      const result = run(new HttpExceptionFilter(), exception);
      expect(result.json).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });
  });

  describe('domain error mapping', () => {
    it('maps ValidationError to 400 VALIDATION_ERROR', () => {
      const result = run(new HttpExceptionFilter(), new ValidationError('Invalid ledger cursor'));
      expect(result.status).toBe(400);
      expect(result.json).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid ledger cursor',
      });
    });

    it('maps IdempotencyConflictError to 409 IDEMPOTENCY_CONFLICT', () => {
      const result = run(new HttpExceptionFilter(), new IdempotencyConflictError('payload differs'));
      expect(result.status).toBe(409);
      expect(result.json).toEqual({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'payload differs',
      });
    });

    it('maps WalletExistsError to 409 WALLET_EXISTS', () => {
      const result = run(new HttpExceptionFilter(), new WalletExistsError('duplicate wallet'));
      expect(result.status).toBe(409);
      expect(result.json).toEqual({
        statusCode: 409,
        code: 'WALLET_EXISTS',
        message: 'duplicate wallet',
      });
    });

    it('maps NotFoundError to 404 NOT_FOUND without failureCode', () => {
      const result = run(new HttpExceptionFilter(), new NotFoundError('Wallet not found'));
      expect(result.status).toBe(404);
      expect(result.json).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Wallet not found',
      });
    });

    it('maps business rejects to 422 TRANSACTION_REJECTED with failureCode', () => {
      const result = run(new HttpExceptionFilter(), new InsufficientFundsError('no funds'));
      expect(result.status).toBe(422);
      expect(result.json).toEqual({
        statusCode: 422,
        code: 'TRANSACTION_REJECTED',
        message: 'no funds',
        status: 'REJECTED',
        failureCode: 'INSUFFICIENT_FUNDS',
      });
    });

    it('keeps the explicit failure code on ReferenceResolutionError', () => {
      const result = run(
        new HttpExceptionFilter(),
        new ReferenceResolutionError('round differs', FailureCode.ReferenceMismatch),
      );
      expect(result.status).toBe(422);
      expect(result.json).toEqual({
        statusCode: 422,
        code: 'TRANSACTION_REJECTED',
        message: 'round differs',
        status: 'REJECTED',
        failureCode: 'REFERENCE_MISMATCH',
      });
    });
  });

  describe('503 contract', () => {
    it('adds Retry-After and INFRASTRUCTURE_ERROR to ServiceUnavailableException', () => {
      const result = run(
        new HttpExceptionFilter(),
        new ServiceUnavailableException('PostgreSQL unreachable'),
      );
      expect(result.status).toBe(503);
      expect(result.json).toEqual({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'PostgreSQL unreachable',
        failureCode: 'INFRASTRUCTURE_ERROR',
      });
      expect(result.headers?.['Retry-After']).toBe('5');
    });

    it('maps a transient connection error (ECONNREFUSED) to 503 with Retry-After', () => {
      const result = run(
        new HttpExceptionFilter(),
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      );
      expect(result.status).toBe(503);
      expect(result.json).toEqual({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        failureCode: 'INFRASTRUCTURE_ERROR',
      });
      expect(result.headers?.['Retry-After']).toBe('5');
    });

    it('maps a failed InfrastructureError domain code to 503', () => {
      const result = run(
        new HttpExceptionFilter(),
        new DomainError('broker down', FailureCode.InfrastructureError),
      );
      expect(result.status).toBe(503);
      expect(result.headers?.['Retry-After']).toBe('5');
    });
  });

  describe('unknown errors', () => {
    it('maps unexpected errors to 500 INTERNAL_ERROR without leaking the message', () => {
      const result = run(new HttpExceptionFilter(), new Error('boom: SELECT * FROM wallet'));
      expect(result.status).toBe(500);
      expect(result.json).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('preserves a 413 http-errors payload instead of collapsing it to 500', () => {
      const tooLarge = Object.assign(new Error('request entity too large'), {
        statusCode: 413,
        expose: true,
      });
      const result = run(new HttpExceptionFilter(), tooLarge);
      expect(result.status).toBe(413);
      expect(result.json).toEqual({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'request entity too large',
      });
    });

    it('preserves a 415 http-errors payload (4xx messages are client-facing)', () => {
      const unsupported = Object.assign(new Error('Unsupported Media Type'), {
        statusCode: 415,
      });
      const result = run(new HttpExceptionFilter(), unsupported);
      expect(result.status).toBe(415);
      expect(result.json).toEqual({
        statusCode: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported Media Type',
      });
    });

    it('masks a non-exposed http-errors 5xx message', () => {
      const exploded = Object.assign(new Error('deadlock in wager_transaction'), {
        statusCode: 500,
        expose: false,
      });
      const result = run(new HttpExceptionFilter(), exploded);
      expect(result.status).toBe(500);
      expect(result.json).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('still logs unexpected errors with cause and stack', () => {
      const spy = spyLogger();
      try {
        run(new HttpExceptionFilter(), new Error('boom'));
        expect(spy.errorCalls).toHaveLength(1);
        const [line, stack] = spy.errorCalls[0] ?? [];
        expect(String(line)).toContain('GET /test -> 500');
        expect(String(stack)).toContain('boom');
      } finally {
        spy.restore();
      }
    });
  });

  describe('logging and hardening (Phase 1 behavior preserved)', () => {
    it('does not write a response when headers were already sent', () => {
      const result = run(
        new HttpExceptionFilter(),
        new HttpException('late', 500),
        { headersSent: true },
      );
      expect(result.status).toBeUndefined();
      expect(result.json).toBeUndefined();
    });

    it('logs cause and stack for 5xx responses without touching the body', () => {
      const spy = spyLogger();
      try {
        const exception = new HttpException('boom', 500, {
          cause: new Error('connection refused'),
        });
        run(new HttpExceptionFilter(), exception);
        expect(spy.warnCalls).toHaveLength(0);
        expect(spy.errorCalls).toHaveLength(1);
        const [line, stack] = spy.errorCalls[0] ?? [];
        expect(String(line)).toContain('GET /test -> 500');
        expect(String(line)).toContain('cause=connection refused');
        expect(String(stack)).toContain('HttpException');
      } finally {
        spy.restore();
      }
    });

    it('logs non-Error string causes with credential redaction', () => {
      const spy = spyLogger();
      try {
        const exception = new HttpException('down', 502, {
          cause: 'postgres://user:pass@db down',
        });
        run(new HttpExceptionFilter(), exception);
        expect(spy.errorCalls).toHaveLength(1);
        const [line] = spy.errorCalls[0] ?? [];
        expect(String(line)).toContain('cause=postgres://***@db down');
        expect(String(line)).not.toContain('user:pass@');
      } finally {
        spy.restore();
      }
    });

    it('omits cause= for non-string, non-Error causes but still logs', () => {
      const spy = spyLogger();
      try {
        const exception = new HttpException('boom', 500, {
          cause: { code: 'E1' },
        });
        run(new HttpExceptionFilter(), exception);
        expect(spy.errorCalls).toHaveLength(1);
        const [line] = spy.errorCalls[0] ?? [];
        expect(String(line)).toContain('-> 500');
        expect(String(line)).not.toContain('cause=');
      } finally {
        spy.restore();
      }
    });

    it('redacts credentials embedded in the logged stack/message argument', () => {
      const spy = spyLogger();
      try {
        const exception = new HttpException(
          'failed for postgres://user:pass@db:5432',
          500,
        );
        run(new HttpExceptionFilter(), exception);
        expect(spy.errorCalls).toHaveLength(1);
        const stackArg = spy.errorCalls[0]?.[1];
        expect(String(stackArg)).not.toContain('user:pass@');
        expect(String(stackArg)).toContain('//***@');
      } finally {
        spy.restore();
      }
    });

    it('still logs a 5xx when headers were already sent, without writing', () => {
      const spy = spyLogger();
      try {
        const result = run(
          new HttpExceptionFilter(),
          new HttpException('late', 500),
          { headersSent: true },
        );
        expect(result.status).toBeUndefined();
        expect(result.json).toBeUndefined();
        expect(spy.errorCalls).toHaveLength(1);
        expect(String(spy.errorCalls[0]?.[0])).toContain('-> 500');
      } finally {
        spy.restore();
      }
    });

    it('redacts credentials embedded in cause messages', () => {
      const spy = spyLogger();
      try {
        const exception = new HttpException('down', 503, {
          cause: new Error('connect ECONNREFUSED postgres://user:pass@db:5432'),
        });
        run(new HttpExceptionFilter(), exception);
        expect(spy.errorCalls).toHaveLength(1);
        const [line] = spy.errorCalls[0] ?? [];
        expect(String(line)).not.toContain('user:pass@');
        expect(String(line)).toContain('//***@');
      } finally {
        spy.restore();
      }
    });

    it('logs the pathname only, dropping query strings', () => {
      const spy = spyLogger();
      try {
        run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { url: '/test?token=secret' },
        );
        expect(spy.warnCalls).toHaveLength(1);
        expect(spy.errorCalls).toHaveLength(0);
        const [line] = spy.warnCalls[0] ?? [];
        expect(String(line)).toContain('/test -> 404');
        expect(String(line)).not.toContain('token=secret');
      } finally {
        spy.restore();
      }
    });

    it('logs only the pathname for absolute-form targets with credentials', () => {
      const spy = spyLogger();
      try {
        run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { url: 'https://user:pass@host/path?token=abc' },
        );
        expect(spy.warnCalls).toHaveLength(1);
        expect(spy.errorCalls).toHaveLength(0);
        const [line] = spy.warnCalls[0] ?? [];
        expect(String(line)).toBe('GET /path -> 404');
        expect(String(line)).not.toContain('user:pass@');
        expect(String(line)).not.toContain('token=');
      } finally {
        spy.restore();
      }
    });

    it('logs "/" for absolute-form targets without a path', () => {
      const spy = spyLogger();
      try {
        run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { url: 'https://www.example.com' },
        );
        expect(spy.warnCalls).toHaveLength(1);
        const [line] = spy.warnCalls[0] ?? [];
        expect(String(line)).toBe('GET / -> 404');
      } finally {
        spy.restore();
      }
    });

    it('redacts credentials in origin-form targets that carry userinfo', () => {
      const spy = spyLogger();
      try {
        run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { url: '//user:pass@host/x' },
        );
        expect(spy.warnCalls).toHaveLength(1);
        const [line] = spy.warnCalls[0] ?? [];
        expect(String(line)).toBe('GET //***@host/x -> 404');
      } finally {
        spy.restore();
      }
    });

    it('logs "/" for URL-shaped targets whose pathname lacks a leading slash', () => {
      const spy = spyLogger();
      try {
        run(
          new HttpExceptionFilter(),
          new HttpException('Not found', 404),
          { url: 'mailto:foo' },
        );
        expect(spy.warnCalls).toHaveLength(1);
        const [line] = spy.warnCalls[0] ?? [];
        expect(String(line)).toBe('GET / -> 404');
      } finally {
        spy.restore();
      }
    });

    it('falls back to "-" and "/" when the request has no method or url', () => {
      const spy = spyLogger();
      try {
        const captured: Captured = {};
        const response: FakeResponse = {
          status(code: number): FakeResponse {
            captured.status = code;
            return response;
          },
          json(body: unknown): void {
            captured.json = body;
          },
          setHeader(): void {},
        };
        const host = {
          switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => ({}),
          }),
        } as unknown as ArgumentsHost;
        new HttpExceptionFilter().catch(new HttpException('boom', 500), host);
        expect(spy.errorCalls).toHaveLength(1);
        const [line] = spy.errorCalls[0] ?? [];
        expect(String(line)).toBe('- / -> 500');
        expect(captured.status).toBe(500);
      } finally {
        spy.restore();
      }
    });
  });
});
