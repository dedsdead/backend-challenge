import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [WalletsController],
  providers: [WalletsService, ReconciliationService],
})
export class WalletsModule {}
