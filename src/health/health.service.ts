import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SQS_PROBER } from './sqs-prober';

/** Readiness contract for the queue probe (plan T047). */
export interface SqsProber {
  probe(): Promise<void>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(SQS_PROBER) private readonly sqs: SqsProber,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ postgres: 'ok'; sqs: 'ok' }> {
    try {
      await this.em.getConnection().execute('SELECT 1');
    } catch (error) {
      throw new ServiceUnavailableException('PostgreSQL unreachable', {
        cause: error,
      });
    }
    try {
      await this.sqs.probe();
    } catch (error) {
      throw new ServiceUnavailableException('SQS unreachable', {
        cause: error,
      });
    }
    return { postgres: 'ok', sqs: 'ok' };
  }
}
