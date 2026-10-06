import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

@Injectable()
export class HealthService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ postgres: 'ok' }> {
    try {
      await this.em.getConnection().execute('SELECT 1');
    } catch (error) {
      throw new ServiceUnavailableException('PostgreSQL unreachable', {
        cause: error,
      });
    }
    return { postgres: 'ok' };
  }
}
