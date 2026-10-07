import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/http/exception.filter';
import { HealthModule } from './health/health.module';
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
    HealthModule,
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
      }),
    },
  ],
})
export class AppModule {}
