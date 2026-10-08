import { Migration } from '@mikro-orm/migrations';

export class Migration20261008055955_AddLedgerKeysetIndex extends Migration {

  override name = 'Migration20261008055955_AddLedgerKeysetIndex';

  override up(): void | Promise<void> {
    this.addSql(`create index "idx_ledger_wallet_created_id" on "wallet_ledger_entry" ("wallet_id", "created_at", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "idx_ledger_wallet_created_id";`);
    this.addSql(`create or replace function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"() returns trigger as \$\$ begin ; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_wallet_ledger_entry_immutable" BEFORE DELETE OR UPDATE on "wallet_ledger_entry" for each ROW execute function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"();`);
  }

}
