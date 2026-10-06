---
name: prisma
description: "Prisma migration discipline — atomic chain for generating, drift-checking, and running migrations. Use when the project uses Prisma and schema changes require a migration."
---

# Prisma Migrations - CLI Only

## CRITICAL: Always Use Prisma CLI for Migrations

You **MUST NEVER** create migration files manually. Always use the Prisma CLI to generate migrations automatically based on schema changes.

## CRITICAL: Generate → Drift-Check → Run IMMEDIATELY (Atomic Chain)

**THIS IS THE #1 SOURCE OF PRODUCTION BUGS.** When a migration is generated but NOT run on the local database immediately, the next `prisma migrate dev` compares against the OLD schema and produces a migration with **schema drift**.

**THE RULE: Every migration MUST be applied on the local DB immediately after generation. Never defer. Never skip. Never "do it later."**

The atomic chain (NEVER break this sequence):

1. Generate:     `npx prisma migrate dev --name MigrationName`
2. Drift-check:  Review the generated migration SQL → fix any unrelated changes
3. Run locally:  `npx prisma migrate dev` (or `npx prisma migrate deploy` for non-dev)
4. Verify:       If migration fails → STOP. Fix the issue before continuing.

**BLOCKING:** Do NOT proceed to the next task, the next schema change, or the next migration until step 3 succeeds.

**Production deployment:** Use `npx prisma migrate deploy` (not `migrate dev`) in production/staging.

**NEVER edit past migrations.** If a migration is wrong, create a new corrective migration.

## Available Commands

From project root:

```bash
# Generate and apply migration (development)
npx prisma migrate dev --name MigrationName

# Generate migration without applying (for review)
npx prisma migrate dev --name MigrationName --create-only

# Apply pending migrations (production/deployment)
npx prisma migrate deploy

# Reset database and reapply all migrations (DANGER - dev only)
npx prisma migrate reset

# Show migration status
npx prisma migrate status

# Generate Prisma Client after schema changes
npx prisma generate
```

## Workflow: Creating a New Migration

### Step 1: Update Schema

1. Edit `prisma/schema.prisma`
2. Add/modify models, fields, relationships, indexes
3. Ensure all `@id`, `@default`, `@relation`, `@index`, `@unique` attributes are correct

### Step 2: Generate Migration

```bash
npx prisma migrate dev --name DescriptiveMigrationName
```

### Step 3: Review Generated Migration

1. **Check the generated SQL** in `prisma/migrations/<timestamp>_<name>/migration.sql`
2. **Verify**: All tables, indexes, foreign keys, column types match schema
3. **Add custom SQL** (if needed): Run additional SQL after migration for constraints/triggers

### Step 4: Schema-drift check and verify

After generating a migration:

1. **Review the generated SQL** for unrelated table or column changes
2. **Run migrations on the local database** so the schema stays aligned
3. **Generate Prisma Client**: `npx prisma generate`

### Step 5: Test Migration

```bash
npx prisma migrate status    # Check pending
npx prisma migrate deploy    # Test deploy (if using --create-only before)
```

## What NEVER to Do

- **NEVER create migration files manually** by copying templates or writing SQL from scratch
- **NEVER edit generated migrations** to change schema (instead, update schema and regenerate)
- **NEVER skip schema changes** and write migrations directly
- **NEVER delete migration files** that have already been run in production
- **NEVER use `migrate dev` in production** - always use `migrate deploy`

## Remember

**Schema changes → Prisma CLI → Migration file → Database**

Never skip the CLI step. Always let Prisma generate migrations from your schema.
