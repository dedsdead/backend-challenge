import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DomainError,
  IdempotencyConflictError,
  InvalidTransactionStateError,
  NotFoundError,
  ValidationError,
  WalletExistsError,
} from '../../domain/errors';
import { FailureCode } from '../../domain/failure-codes';

// Matches //userinfo@authority (greedy up to the last @ before any slash) —
// covers password, passwordless, and @in-password forms.
const CREDENTIALS_IN_URL = /\/\/[^\s/]+@/g;

const TRANSIENT_RE =
  /ECONNREFUSED|connection refused|connection terminated|ETIMEDOUT|timeout exceeded when trying to connect|57P01|57P03|too many connections/i;

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'ROLE_FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'IDEMPOTENCY_CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'TRANSACTION_REJECTED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Validation failed',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Transaction rejected',
  500: 'Internal server error',
  503: 'Service unavailable',
};

/** Client-supplied correlation ids are echoed back — accept only a short,
 * header-safe token so a malicious value cannot shape the response. */
const CORRELATION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

interface Body {
  statusCode: number;
  code: string;
  message: string;
  /** Terminal outcome echo on 422 submit responses (AC-5a: `status: "REJECTED"`). */
  status?: string;
  failureCode?: string;
  transactionId?: string;
  idempotentReplay?: boolean;
  errors?: unknown[];
  correlationId?: string;
}

interface Described {
  status: number;
  body: Body;
  /** Extra text for the log line (cause suffix source for unknown errors). */
  logCause?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorCodeFor(status: number, record: Record<string, unknown>): string {
  const explicit = record['code'];
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const mapped = STATUS_CODES[status];
  if (mapped) return mapped;
  const reason = record['error'];
  if (typeof reason === 'string' && reason.length > 0) {
    const normalized = reason
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (normalized) return normalized;
  }
  return 'HTTP_ERROR';
}

function messageOf(status: number, record: Record<string, unknown>): string {
  const message = record['message'];
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) {
    return message.map((m) => (typeof m === 'string' ? m : String(m))).join(', ');
  }
  return STATUS_MESSAGES[status] ?? 'Error';
}

function describeHttp(exception: HttpException): Described {
  const status = exception.getStatus();
  const raw = exception.getResponse();
  const record = isRecord(raw)
    ? raw
    : { message: typeof raw === 'string' ? raw : undefined };

  const body: Body = {
    statusCode: status,
    code: errorCodeFor(status, record),
    message: messageOf(status, record),
  };
  if (typeof record['failureCode'] === 'string') body.failureCode = record['failureCode'];
  if (typeof record['status'] === 'string') body.status = record['status'];
  if (typeof record['transactionId'] === 'string') body.transactionId = record['transactionId'];
  if (typeof record['idempotentReplay'] === 'boolean') {
    body.idempotentReplay = record['idempotentReplay'];
  }
  if (Array.isArray(record['errors'])) body.errors = record['errors'];
  // 5xx masking: allowlist — only 503 passes through its message + failureCode + Retry-After
  // All other 5xx get fully masked (generic message, no errors, no failureCode, no status)
  if (status >= 500) {
    if (status === 503) {
      body.failureCode ??= FailureCode.InfrastructureError;
      return { status, body };
    }
    // Mask all other 5xx
    body.message = STATUS_MESSAGES[status] ?? STATUS_MESSAGES[500] ?? 'Error';
    delete body.errors;
    delete body.failureCode;
    delete body.status;
    delete body.transactionId;
    delete body.idempotentReplay;
  }
  return { status, body };
}

function describeDomain(exception: DomainError): Described {
  const message = exception.message;
  if (exception instanceof ValidationError) {
    return { status: 400, body: { statusCode: 400, code: 'VALIDATION_ERROR', message } };
  }
  if (exception instanceof IdempotencyConflictError) {
    return { status: 409, body: { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT', message } };
  }
  if (exception instanceof WalletExistsError) {
    return { status: 409, body: { statusCode: 409, code: 'WALLET_EXISTS', message } };
  }
  if (exception instanceof NotFoundError) {
    return { status: 404, body: { statusCode: 404, code: 'NOT_FOUND', message } };
  }
  // Invariant-breaking errors → 500 (masked)
  if (exception instanceof InvalidTransactionStateError) {
    return {
      status: 500,
      body: { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
      logCause: message,
    };
  }
  if (exception.failureCode === FailureCode.InfrastructureError) {
    return {
      status: 503,
      body: {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message,
        failureCode: FailureCode.InfrastructureError,
      },
    };
  }
  // Business rejections → 422 with status: 'REJECTED' (pinned contract AC-5a)
  const body: Body = {
    statusCode: 422,
    code: 'TRANSACTION_REJECTED',
    message,
    status: 'REJECTED',
  };
  if (exception.failureCode !== undefined) body.failureCode = exception.failureCode;
  return { status: 422, body };
}

function describeUnknown(exception: unknown): Described {
  const message = exception instanceof Error ? exception.message : String(exception);
  const code = isRecord(exception) ? String(exception['code'] ?? '') : '';
  if (TRANSIENT_RE.test(message) || TRANSIENT_RE.test(code)) {
    return {
      status: 503,
      body: {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        failureCode: FailureCode.InfrastructureError,
      },
      logCause: message,
    };
  }
  // http-errors shape (body-parser / raw-body / express raise plain objects
  // like { statusCode: 413, expose: true, message }): preserve the real 4xx
  // status instead of collapsing it to 500. 5xx messages are masked.
  const status = isRecord(exception) ? exception['statusCode'] : undefined;
  if (typeof status === 'number' && status >= 400 && status <= 599) {
    const exposed = status < 500 && isRecord(exception) && exception['expose'] === true;
    const body: Body = {
      statusCode: status,
      code: errorCodeFor(status, isRecord(exception) ? exception : {}),
      message: exposed
        ? message
        : (STATUS_MESSAGES[status] ?? STATUS_MESSAGES[500] ?? 'Error'),
    };
    if (status === 503) body.failureCode ??= FailureCode.InfrastructureError;
    return { status, body, logCause: message };
  }
  return {
    status: 500,
    body: { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
    logCause: message,
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();

    let described: Described;
    if (exception instanceof HttpException) {
      described = describeHttp(exception);
    } else if (exception instanceof DomainError) {
      described = describeDomain(exception);
    } else {
      described = describeUnknown(exception);
    }
    const { status, body } = described;

    const request = http.getRequest<Request>();
    const { method, url, headers } = request;
    const withoutQuery = (url ?? '/').split('?')[0] ?? '/';
    let pathname: string;
    if (withoutQuery.startsWith('/')) {
      pathname = withoutQuery;
    } else {
      // absolute-form request-target (proxy-style: https://host/path)
      try {
        const parsed = new URL(withoutQuery).pathname;
        pathname = parsed.startsWith('/') ? parsed : '/';
      } catch {
        pathname = '/';
      }
    }
    const line = `${method ?? '-'} ${pathname} -> ${status}`.replace(
      CREDENTIALS_IN_URL,
      '//***@',
    );
    const correlationId = headers?.['x-correlation-id'];
    const cidSuffix = typeof correlationId === 'string' && CORRELATION_ID_RE.test(correlationId)
      ? ` cid=${correlationId}`
      : '';
    if (status >= 500) {
      const cause =
        exception instanceof HttpException
          ? exception.cause
          : described.logCause;
      const causeText =
        cause instanceof Error
          ? cause.message
          : typeof cause === 'string'
            ? cause
            : '';
      const causeSuffix = causeText
        ? ` cause=${causeText.replace(CREDENTIALS_IN_URL, '//***@')}`
        : '';
      const stackOrMessage = (
        (exception instanceof Error ? exception.stack : undefined) ??
        (exception instanceof Error ? exception.message : String(exception))
      ).replace(CREDENTIALS_IN_URL, '//***@');
      this.logger.error(`${line}${cidSuffix}${causeSuffix}`, stackOrMessage);
    } else {
      this.logger.warn(`${line}${cidSuffix}`);
    }

    if (typeof correlationId === 'string' && CORRELATION_ID_RE.test(correlationId)) {
      body.correlationId = correlationId;
    }

    if (response.headersSent) return;
    if (status === 503) response.setHeader('Retry-After', '5');
    response.status(status).json(body);
  }
}
