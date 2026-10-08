import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager, IsolationLevel } from '@mikro-orm/core';
import { NotFoundError } from '../../domain/errors';
import { Money } from '../../domain/money/money';
import { metrics } from '../../common/metrics/metrics';
import {
  MikroOrmWalletLedgerEntryRepository,
  MikroOrmWalletRepository,
} from '../../database/repositories';
import { ReconciliationResponseDto } from './dto/reconciliation-response.dto';

/**
 * AC-17: compare `wallet.balance` against the ledger sum inside one
 * repeatable-read snapshot; a divergence is reported and counted — never
 * auto-corrected.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async reconcile(walletId: string): Promise<ReconciliationResponseDto> {
    return this.em.transactional(
      async (tx) => {
        const wallet = await new MikroOrmWalletRepository(tx).findById(walletId);
        if (!wallet) throw new NotFoundError('Wallet not found');

        const ledger = new MikroOrmWalletLedgerEntryRepository(tx);
        // fromInternal: a corrupted ledger may sum to a negative amount, and
        // Money.from rejects negatives — reconciliation must report that, not 500.
        const calculated = Money.fromInternal(
          await ledger.sumByWallet(walletId, wallet.balance.currency),
          wallet.balance.currency,
        );
        const checkedEntries = await ledger.countByWallet(walletId);
        const difference = wallet.balance.subtract(calculated);
        const consistent = wallet.balance.equals(calculated);

        const dto = new ReconciliationResponseDto();
        dto.walletId = walletId;
        dto.storedBalance = wallet.balance.toJSON();
        dto.calculatedBalance = calculated.toJSON();
        dto.difference = difference.toJSON();
        dto.consistent = consistent;
        dto.checkedEntries = checkedEntries;

        if (!consistent) {
          this.logger.warn(
            `Reconciliation divergence for wallet ${walletId}: stored=${wallet.balance.amount}, calculated=${calculated.amount}, difference=${difference.amount}`,
          );
          metrics.reconciliationDivergence.inc();
        }
        return dto;
      },
      { isolationLevel: IsolationLevel.REPEATABLE_READ },
    );
  }
}
