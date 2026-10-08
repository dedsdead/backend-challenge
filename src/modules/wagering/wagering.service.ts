import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { NotFoundError } from '../../domain/errors';
import type { WagerTransaction } from '../../domain/wager-transaction/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../database/repositories';

@Injectable()
export class WageringService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async getById(transactionId: string): Promise<WagerTransaction> {
    return this.em.transactional(async (tx) => {
      const found = await new MikroOrmWagerTransactionRepository(tx).findById(transactionId);
      if (!found) throw new NotFoundError('Transaction not found');
      return found;
    });
  }

  /** Provider-scoped lookup: a stored transaction under a different provider
   * is invisible here (AC-20 — no cross-provider existence oracle). */
  async getByProviderExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction> {
    return this.em.transactional(async (tx) => {
      const found = await new MikroOrmWagerTransactionRepository(tx).findByProviderAndExternal(
        providerId,
        externalTransactionId,
      );
      if (!found) throw new NotFoundError('Transaction not found');
      return found;
    });
  }
}
