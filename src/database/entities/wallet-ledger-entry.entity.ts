import { defineEntity } from '@mikro-orm/core';

export const WalletLedgerEntryEntity = defineEntity({
  name: 'WalletLedgerEntryEntity',
  tableName: 'wallet_ledger_entry',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    walletId: { type: 'uuid' },
    transactionId: { type: 'uuid' },
    direction: { type: 'string' },
    moneyAmount: { type: 'decimal', mode: 'string', precision: 20, scale: 2 },
    moneyCurrency: { type: 'string', length: 3 },
    balanceBeforeAmount: { type: 'decimal', mode: 'string', precision: 20, scale: 2 },
    balanceBeforeCurrency: { type: 'string', length: 3 },
    balanceAfterAmount: { type: 'decimal', mode: 'string', precision: 20, scale: 2 },
    balanceAfterCurrency: { type: 'string', length: 3 },
    createdAt: { type: 'datetime', onCreate: () => new Date() },
  },
  indexes: [
    { properties: ['walletId', 'id'], name: 'idx_ledger_wallet_id' },
    { properties: ['transactionId'], name: 'idx_ledger_transaction_id' },
    { properties: ['walletId', 'createdAt', 'id'], name: 'idx_ledger_wallet_created_id' },
  ],
  checks: [
    {
      name: 'ck_ledger_balanced',
      expression: "CASE WHEN direction = 'DEBIT' THEN balance_before_amount - money_amount ELSE balance_before_amount + money_amount END = balance_after_amount",
    },
  ],
});

export type WalletLedgerEntryEntityType = typeof WalletLedgerEntryEntity;