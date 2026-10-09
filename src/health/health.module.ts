import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { createSqsProber, SQS_PROBER } from './sqs-prober';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: SQS_PROBER,
      useFactory: createSqsProber,
      inject: [ConfigService],
    },
  ],
})
export class HealthModule {}
