import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const ALLOWED_FIELDS = ['message', 'error', 'errorCode'] as const;
// Matches //userinfo@authority (greedy up to the last @ before any slash) —
// covers password, passwordless, and @-in-password forms.
const CREDENTIALS_IN_URL = /\/\/[^\s/]+@/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();

    const statusCode = exception.getStatus();
    const raw = exception.getResponse();

    const body: Record<string, unknown> = { statusCode };
    if (typeof raw === 'string') {
      body.message = raw;
    } else if (isRecord(raw)) {
      for (const field of ALLOWED_FIELDS) {
        if (raw[field] !== undefined) body[field] = raw[field];
      }
    }
    if (body.errorCode === undefined && exception.errorCode !== undefined) {
      body.errorCode = exception.errorCode;
    }

    const { method, url } = http.getRequest<Request>();
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
    const line =
      `${method ?? '-'} ${pathname} -> ${statusCode}`.replace(
        CREDENTIALS_IN_URL,
        '//***@',
      );
    if (statusCode >= 500) {
      const cause = exception.cause;
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
        exception.stack ?? exception.message
      ).replace(CREDENTIALS_IN_URL, '//***@');
      this.logger.error(`${line}${causeSuffix}`, stackOrMessage);
    } else {
      this.logger.warn(line);
    }

    if (response.headersSent) return;
    response.status(statusCode).json(body);
  }
}
