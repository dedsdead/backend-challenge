import { Module, ValidationPipe, BadRequestException } from '@nestjs/common';
import type { ValidationError as ClassValidatorError } from 'class-validator';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/http/exception.filter';
import { validationError } from './common/http/validation-error';
import { HealthModule } from './health/health.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { WageringModule } from './modules/wagering/wagering.module';
import { mikroOrmConfig } from './database/mikro-orm.config';
import type { MikroOrmModuleAsyncOptions } from '@mikro-orm/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      useFactory: (config: ConfigService) => ({
        ...mikroOrmConfig,
        dbName: config.get<string>('DATABASE_NAME') ?? mikroOrmConfig.dbName,
        user: config.get<string>('DATABASE_USER') ?? mikroOrmConfig.user,
        password: config.get<string>('DATABASE_PASSWORD') ?? mikroOrmConfig.password,
        host: config.get<string>('DATABASE_HOST') ?? mikroOrmConfig.host,
        port: config.get<number>('DATABASE_PORT') ?? mikroOrmConfig.port,
      }),
      inject: [ConfigService],
    } satisfies MikroOrmModuleAsyncOptions<PostgreSqlDriver>),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 1000,
      },
    ]),
    HealthModule,
    WalletsModule,
    WageringModule,
  ],
  providers: [
    HttpExceptionFilter,
    { provide: APP_FILTER, useExisting: HttpExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ClassValidatorError[]) =>
          validationError(errors),
      }),
    },
  ],
})
export class AppModule {}
