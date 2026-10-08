import { Module } from '@nestjs/common';
import { SubmitTransactionUseCase } from './submit-transaction.use-case';
import { WageringService } from './wagering.service';
import { WageringController } from './wagering.controller';

@Module({
  controllers: [WageringController],
  providers: [SubmitTransactionUseCase, WageringService],
})
export class WageringModule {}
