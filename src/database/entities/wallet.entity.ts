import { defineEntity } from '@mikro-orm/core';
import { v4 } from 'uuid';

export const WalletEntity = defineEntity({
  name: 'WalletEntity',
  tableName: 'wallet',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
    },
    playerId: {
      type: 'uuid',
    },
    currency: {
      type: 'string',
      length: 3,
    },
    balanceAmount: {
      type: 'decimal',
      mode: 'string',
      precision: 20,
      scale: 2,
    },
    version: {
      type: 'int',
      default: 1,
      version: true,
    },
    createdAt: {
      type: 'datetime',
      onCreate: () => new Date(),
    },
    updatedAt: {
      type: 'datetime',
      onCreate: () => new Date(),
      onUpdate: () => new Date(),
    },
  },
  indexes: [
    { properties: ['playerId'], name: 'idx_wallet_player_id' },
  ],
  uniques: [
    { properties: ['playerId', 'currency'], name: 'uq_wallet_player_currency' },
  ],
  checks: [
    { name: 'ck_wallet_balance_non_negative', expression: 'balance_amount >= 0' },
  ],
});

export type WalletEntityType = typeof WalletEntity;