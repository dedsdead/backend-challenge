import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { IsInt } from 'class-validator';
import { Type } from 'class-transformer';
// ApplicationConfig is not re-exported from @nestjs/core's root, but the
// package `exports` map allows `./*` subpaths (verified: application-config.d.ts).
import { ApplicationConfig } from '@nestjs/core/application-config';
import { HttpExceptionFilter } from '../../src/common/http/exception.filter';

// The `??=` defaults below MUST stay above any module evaluation that triggers
// AppModule: ConfigModule.forRoot() validates env synchronously at module import
// time, and static imports hoist above these statements — that is why AppModule
// is imported dynamically inside beforeAll instead of at the top of this file.
process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??=
  'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??=
  'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';

describe('bootstrap (AppModule)', () => {
  let app: INestApplication | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../../src/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP AddressInfo from listen(0)');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 15_000);

  afterAll(async () => {
    await app?.close();
  }, 15_000);

  it('wires the filter and pipe as global enhancers', () => {
    if (!app) throw new Error('app failed to boot');
    expect(app.get(HttpExceptionFilter)).toBeInstanceOf(HttpExceptionFilter);

    const config = app.get(ApplicationConfig);
    expect(
      config.getGlobalFilters().some((f) => f instanceof HttpExceptionFilter),
    ).toBe(true);

    // Nest's ValidationPipe keeps its options protected, so the flags are
    // asserted behaviorally below; registration is asserted here.
    expect(
      config.getGlobalPipes().some((p) => p instanceof ValidationPipe),
    ).toBe(true);
  });

  it('global ValidationPipe enforces whitelist, forbidNonWhitelisted, transform', async () => {
    if (!app) throw new Error('app failed to boot');
    const config = app.get(ApplicationConfig);
    const pipe = config.getGlobalPipes().find((p) => p instanceof ValidationPipe);
    if (!(pipe instanceof ValidationPipe)) {
      throw new Error('expected a global ValidationPipe');
    }

    class ProbeDto {
      @Type(() => Number)
      @IsInt()
      port!: number;
    }

    // transform: input coercion '8080' -> 8080
    const transformed: ProbeDto = await pipe.transform(
      { port: '8080' },
      { type: 'body', metatype: ProbeDto, data: '' },
    );
    expect(transformed.port).toBe(8080);

    // whitelist + forbidNonWhitelisted: unknown property -> 400
    await expect(
      pipe.transform(
        { port: 8080, extraneous: true },
        { type: 'body', metatype: ProbeDto, data: '' },
      ),
    ).rejects.toThrow();
  });

  it('GET /health/live returns 200 {status:ok}', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 {postgres:ok}', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postgres: 'ok' });
  });

  it('GET /unknown returns 404 with only allowlisted fields', async () => {
    const res = await fetch(`${baseUrl}/definitely-not-a-route`);
    expect(res.status).toBe(404);
    const body: Record<string, unknown> = await res.json();
    expect(Object.keys(body).sort()).toEqual(['error', 'message', 'statusCode']);
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
  });
});
