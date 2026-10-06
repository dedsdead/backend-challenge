import { describe, expect, it } from 'bun:test';
import {
  BadRequestException,
  HttpException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../../../../src/common/http/exception.filter';

interface Captured {
  status?: number;
  json?: unknown;
}

interface FakeResponse {
  headersSent?: boolean;
  status(code: number): FakeResponse;
  json(body: unknown): void;
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
  exception: HttpException,
  init?: { headersSent?: boolean; url?: string },
): Captured {
  const captured: Captured = {};
  const response: FakeResponse = {
    headersSent: init?.headersSent,
    status(code: number): FakeResponse {
      captured.status = code;
      return response;
    },
    json(body: unknown): void {
      captured.json = body;
    },
  };
  const request = { method: 'GET', url: init?.url ?? '/test' };
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
  it('maps a string response to { statusCode, message }', () => {
    const result = run(new HttpExceptionFilter(), new HttpException('Not found', 404));
    expect(result.status).toBe(404);
    expect(result.json).toEqual({ statusCode: 404, message: 'Not found' });
  });

  it('preserves message and error from subclass bodies', () => {
    const result = run(new HttpExceptionFilter(), new BadRequestException('invalid'));
    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      statusCode: 400,
      message: 'invalid',
      error: 'Bad Request',
    });
  });

  it('never leaks fields outside the allowlist', () => {
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
      message: 'Something failed',
    });
  });

  it('always derives statusCode from getStatus(), not the body', () => {
    const exception = new HttpException(
      { statusCode: 418, message: 'teapot' },
      400,
    );
    const result = run(new HttpExceptionFilter(), exception);
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ statusCode: 400, message: 'teapot' });
  });

  it('merges instance-level errorCode into string-body responses', () => {
    const exception = new HttpException('boom', 500, { errorCode: 'E_X' });
    const result = run(new HttpExceptionFilter(), exception);
    expect(result.json).toEqual({
      statusCode: 500,
      message: 'boom',
      errorCode: 'E_X',
    });
  });

  it('passes errorCode provided via subclass options', () => {
    const exception = new BadRequestException('invalid', {
      errorCode: 'E_VALIDATION',
    });
    const result = run(new HttpExceptionFilter(), exception);
    expect(result.json).toEqual({
      statusCode: 400,
      message: 'invalid',
      error: 'Bad Request',
      errorCode: 'E_VALIDATION',
    });
  });

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
      expect(String(line)).toContain(
        'cause=postgres://***@db down',
      );
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
      expect(spy.errorCalls).toHaveLength(0);
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
      expect(spy.errorCalls).toHaveLength(0);
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
      expect(spy.errorCalls).toHaveLength(0);
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
