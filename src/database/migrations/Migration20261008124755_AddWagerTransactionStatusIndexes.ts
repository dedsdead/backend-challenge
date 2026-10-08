import { Migration } from '@mikro-orm/migrations';

export class Migration20261008124755_AddWagerTransactionStatusIndexes extends Migration {

  override name = 'Migration20261008124755_AddWagerTransactionStatusIndexes';

  override up(): void | Promise<void> {
    this.addSql(`create index "idx_wager_tx_status" on "wager_transaction" ("status");`);
    this.addSql(`create index "idx_wager_tx_status_ref_next_attempt" on "wager_transaction" ("status", "reference_next_attempt_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "idx_wager_tx_status";`);
    this.addSql(`drop index "idx_wager_tx_status_ref_next_attempt";`);

    this.addSql(`create or replace function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"() returns trigger as \$\$ begin ; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_wallet_ledger_entry_immutable" BEFORE DELETE OR UPDATE on "wallet_ledger_entry" for each ROW execute function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"();`);
  }

}
