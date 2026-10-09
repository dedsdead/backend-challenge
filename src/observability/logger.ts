import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { LoggerService } from '@nestjs/common';

/** Base binding required by README §12 / plan T045. */
export const SERVICE_NAME = 'wagering-processor';

/**
 * Financial field names that should be redacted at any nesting level.
 * These are common in transaction/wallet logs and must never appear in logs.
 */
const FINANCIAL_FIELDS = [
  'amount',
  'currency',
  'walletId',
  'playerId',
  'balance',
  'balanceBefore',
  'balanceAfter',
  'initialBalance',
  'money',
];

/**
 * Generates redaction paths for financial fields at multiple nesting depths.
 * fast-redact `*.key` matches one level down; we generate paths up to 4 levels deep.
 */
function generateFinancialRedactionPaths(): string[] {
  const paths: string[] = [];
  // Top-level fields
  paths.push(...FINANCIAL_FIELDS);
  // Nested fields up to 4 levels deep: *.field, *.*.field, *.*.*.field, *.*.*.*.field
  for (let depth = 1; depth <= 4; depth++) {
    const prefix = '*'.repeat(depth).split('').join('.');
    for (const field of FINANCIAL_FIELDS) {
      paths.push(`${prefix}.${field}`);
    }
  }
  return paths;
}

/**
 * Redaction paths (plan T045): no authorization headers and no financial
 * payloads in logs. The plan's `*.data` / `*.payload` / `*.body` wildcards
 * cover one level down; the bare paths cover the same keys at the top level
 * (fast-redact `*.x` does not match `x` itself).
 * Additionally, financial fields are redacted at any nesting depth up to 4 levels.
 */
const payloadKeys = ['data', 'payload', 'body'];
const FINANCIAL_REDACTION_PATHS = generateFinancialRedactionPaths();
const REDACT_PATHS = [
  'req.headers.authorization',
  '*.headers.authorization',
  ...payloadKeys,
  ...payloadKeys.map((key) => `*.${key}`),
  ...FINANCIAL_REDACTION_PATHS,
];

export interface CreateLoggerOptions {
  destination?: DestinationStream;
  level?: string;
}

export const loggerOptions = (options: CreateLoggerOptions = {}): LoggerOptions => ({
  level: options.level ?? process.env.LOG_LEVEL ?? 'info',
  base: { service: SERVICE_NAME },
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
});

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const opts = loggerOptions(options);
  return options.destination ? pino(opts, options.destination) : pino(opts);
};

/** Process-wide logger used by the Nest adapter. */
export const pinoLogger: Logger = createLogger();

type PinoLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * NestJS `LoggerService` adapter so framework and module logs (consumer,
 * workers, exception filter) are emitted as JSON with the service binding.
 */
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor(options: CreateLoggerOptions = {}) {
    this.logger = options.destination ? createLogger(options) : pinoLogger;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  setLogLevels(): void {
    // levels come from LOG_LEVEL / loggerOptions; nothing to switch at runtime
  }

  private write(level: PinoLevel, message: unknown, rest: unknown[]): void {
    const bindings: Record<string, unknown> = {};
    let context: string | undefined;
    for (const param of rest) {
      if (typeof param === 'string') {
        context = param;
      } else if (param instanceof Error) {
        bindings.err = param;
      } else if (param && typeof param === 'object') {
        Object.assign(bindings, param);
      }
    }
    if (context) bindings.context = context;

    if (message instanceof Error) {
      bindings.err = bindings.err ?? message;
      this.logger[level](bindings, message.message);
      return;
    }
    this.logger[level](bindings, String(message));
  }
}
