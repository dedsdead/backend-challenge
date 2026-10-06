import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const HOSTS = ['127.0.0.1', '0.0.0.0'] as const;

export class EnvSchema {
  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\/\S+$/i, {
    message: 'must be a postgres:// or postgresql:// URL',
  })
  DATABASE_URL!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  SQS_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  SQS_QUEUE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SQS_DLQ_URL!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  KEYCLOAK_ISSUER!: string;

  @IsString()
  @IsNotEmpty()
  KEYCLOAK_AUDIENCE!: string;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL!: (typeof LOG_LEVELS)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsIn(HOSTS)
  HOST!: (typeof HOSTS)[number];

  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  WORKERS_ENABLED!: boolean;
}

export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const instance = plainToInstance(EnvSchema, config);

  instance.SQS_ENDPOINT ??= 'http://localhost:4566';
  instance.PORT ??= 3000;
  instance.LOG_LEVEL ??= 'info';
  instance.HOST ??= '127.0.0.1';
  instance.WORKERS_ENABLED ??= true;

  const errors = validateSync(instance);
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }

  return instance;
}
