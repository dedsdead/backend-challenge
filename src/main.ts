import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PinoLoggerService } from './observability/logger';

let app: INestApplication | undefined;

async function bootstrap(): Promise<void> {
  app = await NestFactory.create(AppModule, {
    logger: new PinoLoggerService(),
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  // Security hardening
  app.use(helmet());
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const config = app.get(ConfigService);
  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
  app.flushLogs();
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  app?.flushLogs();
  process.exit(1);
});
