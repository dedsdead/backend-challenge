import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

let app: INestApplication | undefined;

async function bootstrap(): Promise<void> {
  app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();

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
