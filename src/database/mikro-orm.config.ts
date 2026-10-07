// mikro-orm.config.ts
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { WalletEntity } from './entities/wallet.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';

export const mikroOrmConfig = {
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  dbName: process.env.DATABASE_NAME ?? 'wagering',
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'local',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  driver: PostgreSqlDriver,
  migrations: {
    path: './src/database/migrations',
    tableName: 'mikro_orm_migrations',
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts' as const,
  },
  // The ledger immutability trigger is owned by migration 001 (T020), not by
  // entity metadata; never diff-drop DB triggers that entities do not mirror.
  schemaGenerator: {
    ignoreTriggers: true,
  },
  debug: false,
  allowGlobalContext: false,
};

export default mikroOrmConfig;

export async function createMikroORM(configService: ConfigService) {
  return MikroORM.init({
    entities: [
      WalletEntity,
      WagerTransactionEntity,
      WalletLedgerEntryEntity,
      InboxMessageEntity,
      OutboxMessageEntity,
    ],
    dbName: configService.get<string>('DATABASE_NAME') ?? 'wagering',
    user: configService.get<string>('DATABASE_USER') ?? 'postgres',
    password: configService.get<string>('DATABASE_PASSWORD') ?? 'local',
    host: configService.get<string>('DATABASE_HOST') ?? 'localhost',
    port: configService.get<number>('DATABASE_PORT') ?? 5432,
    driver: PostgreSqlDriver,
    migrations: {
      path: './src/database/migrations',
      tableName: 'mikro_orm_migrations',
      transactional: true,
      disableForeignKeys: false,
      allOrNothing: true,
      emit: 'ts' as const,
    },
    schemaGenerator: {
      ignoreTriggers: true,
    },
    debug: configService.get('NODE_ENV') === 'development',
    allowGlobalContext: false,
  });
}
