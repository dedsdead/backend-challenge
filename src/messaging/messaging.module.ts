import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WagerTransactionConsumer } from './wager-transaction.consumer';
import { WageringModule } from '../modules/wagering/wagering.module';

/**
 * Messaging module that wires the SQS consumer lifecycle.
 *
 * The consumer starts polling when the application boots (if WORKERS_ENABLED=true)
 * and stops gracefully on shutdown.
 */
@Module({
  imports: [ConfigModule, WageringModule],
  providers: [WagerTransactionConsumer],
  exports: [WagerTransactionConsumer],
})
export class MessagingModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly consumer: WagerTransactionConsumer,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED') === true) {
      await this.consumer.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.stop();
  }
}