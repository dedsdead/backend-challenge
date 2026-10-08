import { defineEntity } from '@mikro-orm/core';

export const WagerTransactionEntity = defineEntity({
  name: 'WagerTransactionEntity',
  tableName: 'wager_transaction',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    providerId: { type: 'string' },
    externalTransactionId: { type: 'string' },
    idempotencyKey: { type: 'string' },
    payloadHash: { type: 'string' },
    walletId: { type: 'uuid' },
    playerId: { type: 'uuid' },
    roundId: { type: 'uuid' },
    gameId: { type: 'uuid' },
    kind: { type: 'string' },
    moneyAmount: { type: 'decimal', mode: 'string', precision: 20, scale: 2 },
    moneyCurrency: { type: 'string', length: 3 },
    referenceExternalTransactionId: { type: 'string', nullable: true },
    status: { type: 'string', default: 'PENDING' },
    referenceTransactionId: { type: 'uuid', nullable: true },
    failureCode: { type: 'string', nullable: true },
    processedAt: { type: 'timestamptz', nullable: true },
    resultBalanceAmount: { type: 'decimal', mode: 'string', precision: 20, scale: 2, nullable: true },
    resultBalanceCurrency: { type: 'string', length: 3, nullable: true },
    referenceAttempts: { type: 'int', default: 0 },
    referenceNextAttemptAt: { type: 'timestamptz', nullable: true },
    createdAt: { type: 'datetime', onCreate: () => new Date() },
  },
  indexes: [
    { properties: ['walletId', 'id'], name: 'idx_wager_tx_wallet_id' },
    { properties: ['referenceTransactionId'], name: 'idx_wager_tx_reference_tx_id' },
  ],
  uniques: [
    { properties: ['idempotencyKey'], name: 'uq_wager_tx_idempotency_key' },
    { properties: ['providerId', 'externalTransactionId'], name: 'uq_wager_tx_provider_external' },
    { properties: ['referenceTransactionId', 'kind'], name: 'uq_wager_tx_reference_kind', where: "status = 'PROCESSED'" },
  ],
  checks: [
    {
      name: 'ck_wager_tx_ref_required',
      expression: "(kind NOT IN ('REFUND', 'ROLLBACK')) OR reference_external_transaction_id IS NOT NULL",
    },
  ],
});

export type WagerTransactionEntityType = typeof WagerTransactionEntity;