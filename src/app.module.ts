import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/http/exception.filter';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      useFactory: (config: ConfigService) => ({
        clientUrl: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        discovery: { warnWhenNoEntities: false },
        migrations: { tableName: 'mikro_orm_migrations' },
      }),
      inject: [ConfigService],
    }),
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
