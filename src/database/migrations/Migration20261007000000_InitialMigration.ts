import { Migration } from '@mikro-orm/migrations';

export class Migration20261007000000_InitialMigration extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    this.addSql(`
      CREATE TABLE "wallet" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "currency" varchar(3) NOT NULL,
        "balance_amount" numeric(20,2) NOT NULL,
        "version" int NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE TABLE "wager_transaction" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider_id" varchar(255) NOT NULL,
        "external_transaction_id" varchar(255) NOT NULL,
        "idempotency_key" varchar(255) NOT NULL,
        "payload_hash" varchar(255) NOT NULL,
        "wallet_id" uuid NOT NULL,
        "player_id" uuid NOT NULL,
        "round_id" uuid NOT NULL,
        "game_id" uuid NOT NULL,
        "kind" varchar(255) NOT NULL,
        "money_amount" numeric(20,2) NOT NULL,
        "money_currency" varchar(3) NOT NULL,
        "reference_external_transaction_id" varchar(255),
        "status" varchar(255) NOT NULL DEFAULT 'PENDING',
        "reference_transaction_id" uuid,
        "failure_code" varchar(255),
        "processed_at" timestamptz,
        "result_balance_amount" numeric(20,2),
        "result_balance_currency" varchar(3),
        "reference_attempts" int NOT NULL DEFAULT 0,
        "reference_next_attempt_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "wager_transaction_pkey" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE TABLE "wallet_ledger_entry" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid NOT NULL,
        "transaction_id" uuid NOT NULL,
        "direction" varchar(255) NOT NULL,
        "money_amount" numeric(20,2) NOT NULL,
        "money_currency" varchar(3) NOT NULL,
        "balance_before_amount" numeric(20,2) NOT NULL,
        "balance_before_currency" varchar(3) NOT NULL,
        "balance_after_amount" numeric(20,2) NOT NULL,
        "balance_after_currency" varchar(3) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "wallet_ledger_entry_pkey" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE TABLE "inbox_message" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "message_id" varchar(255) NOT NULL,
        "consumer_name" varchar(255) NOT NULL,
        "payload_hash" varchar(255) NOT NULL,
        "received_at" timestamptz NOT NULL,
        "processed_at" timestamptz,
        CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE TABLE "outbox_message" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "aggregate_id" uuid NOT NULL,
        "event_type" varchar(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "published_at" timestamptz,
        CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE INDEX "idx_wallet_player_id" ON "wallet" ("player_id");
      CREATE UNIQUE INDEX "uq_wallet_player_currency" ON "wallet" ("player_id", "currency");
      ALTER TABLE "wallet" ADD CONSTRAINT "ck_wallet_balance_non_negative" CHECK (balance_amount >= 0);
    `);

    this.addSql(`
      CREATE INDEX "idx_wager_tx_wallet_id" ON "wager_transaction" ("wallet_id", "id");
      CREATE INDEX "idx_wager_tx_reference_tx_id" ON "wager_transaction" ("reference_transaction_id");
      CREATE UNIQUE INDEX "uq_wager_tx_idempotency_key" ON "wager_transaction" ("idempotency_key");
      CREATE UNIQUE INDEX "uq_wager_tx_provider_external" ON "wager_transaction" ("provider_id", "external_transaction_id");
      CREATE UNIQUE INDEX "uq_wager_tx_reference_kind" ON "wager_transaction" ("reference_transaction_id", "kind") WHERE status = 'PROCESSED';
      ALTER TABLE "wager_transaction" ADD CONSTRAINT "ck_wager_tx_ref_required" CHECK ((kind NOT IN ('REFUND', 'ROLLBACK')) OR reference_external_transaction_id IS NOT NULL);
    `);

    this.addSql(`
      CREATE INDEX "idx_ledger_wallet_id" ON "wallet_ledger_entry" ("wallet_id", "id");
      CREATE INDEX "idx_ledger_transaction_id" ON "wallet_ledger_entry" ("transaction_id");
      ALTER TABLE "wallet_ledger_entry" ADD CONSTRAINT "ck_ledger_balanced" CHECK (CASE WHEN direction = 'DEBIT' THEN balance_before_amount - money_amount ELSE balance_before_amount + money_amount END = balance_after_amount);
    `);

    this.addSql(`
      CREATE FUNCTION "raise_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entry rows are immutable';
      END;
      $$;
    `);

    this.addSql(`
      CREATE TRIGGER "trg_wallet_ledger_entry_immutable" BEFORE UPDATE OR DELETE ON "wallet_ledger_entry" FOR EACH ROW EXECUTE FUNCTION "raise_immutable"();
    `);

    this.addSql(`
      CREATE INDEX "idx_inbox_consumer_message" ON "inbox_message" ("consumer_name", "message_id");
      CREATE UNIQUE INDEX "uq_inbox_consumer_message" ON "inbox_message" ("consumer_name", "message_id");
    `);

    this.addSql(`
      CREATE INDEX "idx_outbox_published_next_attempt" ON "outbox_message" ("published_at", "next_attempt_at");
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "mikro_orm_migrations" (
        "id" serial NOT NULL,
        "name" varchar(255) NOT NULL,
        "executed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "mikro_orm_migrations_pkey" PRIMARY KEY ("id")
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS "trg_wallet_ledger_entry_immutable" ON "wallet_ledger_entry";
      DROP FUNCTION IF EXISTS "raise_immutable"();
    `);

    // mikro_orm_migrations is owned by the migrator (it unlogs into it) and
    // must survive down().
    this.addSql(`
      DROP TABLE IF EXISTS "outbox_message";
      DROP TABLE IF EXISTS "inbox_message";
      DROP TABLE IF EXISTS "wallet_ledger_entry";
      DROP TABLE IF EXISTS "wager_transaction";
      DROP TABLE IF EXISTS "wallet";
    `);
  }
}
