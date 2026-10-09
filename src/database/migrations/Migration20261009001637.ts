import { Migration } from '@mikro-orm/migrations';

export class Migration20261009001637 extends Migration {

  override name = 'Migration20261009001637';

  override up(): void | Promise<void> {
    // Add event_id column as nullable first
    this.addSql(`alter table "outbox_message" add "event_id" uuid null;`);
    // Backfill existing rows with id as event_id
    this.addSql(`update "outbox_message" set "event_id" = "id" where "event_id" is null;`);
    // Now set NOT NULL
    this.addSql(`alter table "outbox_message" alter column "event_id" set not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "outbox_message" drop column "event_id";`);

    this.addSql(`create or replace function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"() returns trigger as $$ begin ; end; $$ language plpgsql;`);
    this.addSql(`create trigger "trg_wallet_ledger_entry_immutable" BEFORE DELETE OR UPDATE on "wallet_ledger_entry" for each ROW execute function "wallet_ledger_entry_trg_wallet_ledger_entry_immutable_fn"();`);
  }

}
