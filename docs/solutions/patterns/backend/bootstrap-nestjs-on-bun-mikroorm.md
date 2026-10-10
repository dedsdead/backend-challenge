---
title: "Bootstrap NestJS-on-Bun with MikroORM v7 — Project Pattern"
problem_type: pattern
category: backend
components:
  - backend
tags:
  - patterns
  - nestjs
  - bun
  - mikro-orm
  - decorator-metadata
  - dependency-injection
  - env-validation
  - integration-testing
  - bootstrap
module: wagering-processor
date: 2026-10-06
established_in: "Phase 1 (Foundation & Local Stack) of docs/plans/20261006111327-full-wagering-processor-plan.md, 2026-10-06"
---

# Pattern: Bootstrap NestJS-on-Bun with MikroORM v7

## Problem / When to Use This

This service runs **NestJS 12 on Bun (not Node) with TypeORM-style DI via MikroORM v7**. Bun does not
type-check and transpiles decorators differently from `tsc`/`node-ts`, and `@mikro-orm/nestjs@7.1.0`
registers providers under tokens that are easy to mismatch. Every symptom in this pattern fails
*silently* or with a misleading message (constructor DI reports `can't resolve dependencies`,
a swallowed `TypeError` becomes a `console.warn`, zero entities throw a hard error). Use this
whenever you touch: `tsconfig.json`, `src/app.module.ts`, `src/database/mikro-orm.config.ts`,
a new `@Injectable()` that needs the
`EntityManager`, a new env var, a new integration/e2e spec, or the docker stack — i.e. all of
Phases 2–9.

## Source of Truth Files

- `tsconfig.json` — decorator metadata + Bun module resolution (L5–L9, L14)
- `src/app.module.ts` — `ConfigModule.forRoot` (L43), `MikroOrmModule.forRootAsync`
  (L44–L55; the factory spreads `mikroOrmConfig` from
  `src/database/mikro-orm.config.ts`, Phase 3); Phase 4 added the `WalletsModule` /
  `WageringModule` imports and the `ValidationPipe` flags + `exceptionFactory`
  (L60–L80)
- `src/database/mikro-orm.config.ts` — shared options object (entities, migrations,
  `schemaGenerator.ignoreTriggers`, `allowGlobalContext: false`) read by both Nest DI and
  the `mikro-orm` CLI (Phase 3)
- `src/config/env.validation.ts` — `EnvSchema` (L28), `validateEnv` (L73), throw (L89)
- `src/health/health.service.ts` — canonical `@Inject(EntityManager)` usage (L2, L7)
- `tests/integration/bootstrap.spec.ts` — canonical integration harness (env `??=` block,
  dynamic `import()` in `beforeAll`, `listen(0, '127.0.0.1')`, 15s hook timeout)
- `package.json` scripts: `validate` (`tsc --noEmit`), `test`, `test:unit`, `test:integration`,
  `test:concurrency`, `mikro-orm` (migration CLI — always pass
  `--config src/database/mikro-orm.config.ts`, see `docs/infrastructure.md`)
- Library internals that define the rules:
  - `node_modules/@mikro-orm/nestjs/mikro-orm.common.js` (`getEntityManagerToken` L30, `InjectEntityManager` L37)
  - `node_modules/@mikro-orm/nestjs/mikro-orm-core.module.js` (`createEntityManager` L80–L111)
  - `node_modules/@mikro-orm/nestjs/mikro-orm.providers.js` (L33–L48)
  - `node_modules/@mikro-orm/core/utils/Configuration.js` (L436–L437)
  - `node_modules/@nestjs/config/dist/config.module.js` (`options.validate(config)` L52–L55)
- Session record: `docs/plans/20261006111327-full-wagering-processor-plan.md` → "Execution Log" →
  `2026-10-06 — Phase 1` (Bun upgrade, MikroORM deviations, verification evidence),
  `2026-10-07 — Phases 2 + 3` (entities/migrations/repositories, app.module factory spread), and
  `2026-10-08 — Phase 4` (wallets/wagering modules, exception-filter rewrite, pinned
  EM/DI decision)

## Current Implementation Snapshot

- **Runtime**: Bun `1.4.2` (`bun --version`), scripts `dev: bun run src/main.ts`,
  `validate: tsc --noEmit` (TypeScript `7.0.2`), `test: bun test` with
  `test:unit` / `test:integration` / `test:concurrency`
  (`tests/concurrency/` holds 3 specs since Phase 5) splits.
- **`tsconfig.json`**: `experimentalDecorators: true`, `emitDecoratorMetadata: true`,
  `module: esnext`, `moduleResolution: bundler`, `types: ["bun"]`, `strict`,
  `noUncheckedIndexedAccess`, `include: [src, tests]`.
- **`src/app.module.ts`**: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`;
  `MikroOrmModule.forRootAsync({ driver: PostgreSqlDriver, useFactory, inject: [ConfigService] })`
  where the factory spreads `mikroOrmConfig` from `src/database/mikro-orm.config.ts`
  (entities, migrations, `schemaGenerator.ignoreTriggers`, `allowGlobalContext: false`)
  and layers `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_HOST` /
  `DATABASE_PORT` over the config defaults — the ORM does **not** parse `DATABASE_URL`
  (known env-contract split — still open after Phase 4; `docs/infrastructure.md` →
  Deferred gaps). Global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` +
  `transform`, with the Phase 4 `exceptionFactory` that flattens class-validator
  children to dotted paths like `money.amount` with non-empty constraints — AC-24/G9)
  and `HttpExceptionFilter` are registered as DI providers — `{ provide: APP_PIPE,
  useValue }`
  and `{ provide: APP_FILTER, useExisting: HttpExceptionFilter }` (with the class also in
  `providers`) — so any app built from `AppModule` (including the integration harness)
  gets the real wiring; `main.ts` no longer registers globals via `useGlobal*`.
- **`src/main.ts`**: `NestFactory.create(AppModule, { logger: new PinoLoggerService(),
  bufferLogs: true })` (pino adapter from `src/observability/logger.ts`, Phase 8/T045),
  `enableShutdownHooks()`, `listen(config.getOrThrow<number>('PORT'),
  config.getOrThrow<string>('HOST'))` (validated values via `ConfigService` — never raw
  `process.env`; `HOST` defaults to `127.0.0.1` so the dev server is loopback-only),
  `app.flushLogs()`; `bootstrap().catch(...)` logs, flushes buffered logs, and
  `process.exit(1)`s so diagnostics are not lost.
- **Injection**: `HealthService` uses a **value** import of `EntityManager` from `@mikro-orm/core`
  and `@Inject(EntityManager)` — never `@InjectEntityManager()`.
- **Env**: `validateEnv` (`class-validator` + `class-transformer`) applies defaults
  (`SQS_ENDPOINT`, `PORT`, `LOG_LEVEL`, `HOST`, `WORKERS_ENABLED`) then throws
  `Invalid environment configuration — <prop>: <constraints>` with all errors joined.
  Optional vars carry defaults here; required vars (`DATABASE_URL`, SQS URLs, Keycloak)
  must fail boot and get no default.
- **Stack**: `docker-compose.yml` → `postgres:16` (5432), `localstack/localstack:4.13.1`
  (4566, `SERVICES: sqs`), `quay.io/keycloak/keycloak:26.8` (`start-dev --import-realm`,
  mounts `./keycloak/realm-export.json`); all three have healthchecks and bind
  `127.0.0.1` only; no app container (app runs on host via Bun).
- **Tests**: baseline 2026-10-09 (Phase 9): `bun run validate` exit 0, unit 256 pass /
  0 fail (26 files), all integration suites green when run individually (14 suites), concurrency (4 specs)
  pass / 0 fail (10 tests). Suites: `tests/unit/config/env.validation.spec.ts`,
  `tests/unit/health/health.service.spec.ts` (services constructed directly with a mocked EM,
  no DI container), `tests/unit/common/http/exception.filter.spec.ts` (pinned
  `{statusCode, code, message, ...}` contract, domain-error mapping, 503 contract,
  unknown/http-errors handling, 5xx logging/credential redaction, `headersSent`),
  `tests/integration/bootstrap.spec.ts` (global wiring, health, Phase 4 error
  contract on 404, plus correlation-id middleware and readiness `{postgres, sqs}` —
  Phase 8), plus
  Phase 2 `tests/unit/domain/*.spec.ts` (9 files), Phase 3
  `tests/integration/schema.spec.ts`, `tests/integration/repositories.spec.ts`,
  `tests/integration/entities/*.spec.ts` (4 files), Phase 4
  `tests/integration/{http-api,wallets.http,wagering.http,wallets.service,submit-transaction.use-case}.spec.ts`
  with `tests/unit/modules/`, `tests/unit/common/dto/`, `tests/unit/common/idempotency/`,
  Phase 6 `tests/integration/sqs-ingress.spec.ts` +
  `tests/unit/messaging/wager-transaction.consumer.spec.ts`, Phase 7
  `tests/integration/{outbox-publisher,pending-reference}.worker.spec.ts` +
  `tests/integration/workers.spec.ts`, Phase 8
  `tests/integration/{auth-observability,metrics}.spec.ts` +
  `tests/unit/auth/{jwt.guard,roles.guard}.spec.ts`,
  `tests/unit/observability/*.spec.ts`, `tests/unit/health/sqs-prober.spec.ts`,
  `tests/unit/keycloak/realm-export.spec.ts`, and Phase 9
  `tests/integration/crash-recovery.spec.ts`, `tests/concurrency/spec-section13.spec.ts`,
  `tests/unit/common/idempotency/payload-hash.spec.ts`
  (token helper `tests/helpers/keycloak-token.ts`).

## Planned / Optional Extensions (If Applicable)

*Implemented since this pattern was written:* (Phase 3, 2026-10-07) entity classes in
`src/database/entities/`, the shared options file `src/database/mikro-orm.config.ts`
(read by both Nest DI and the `mikro-orm` CLI), the migration chain in
`src/database/migrations/` (001 applied), and the persistence integration suites
(`schema.spec.ts`, `repositories.spec.ts`, `entities/*.spec.ts`).

Also (Phase 4, 2026-10-08) the **EM/DI scope decision is pinned**: services inject the
root `EntityManager` as a *transaction factory* (`@Inject(EntityManager)`), then
construct repositories per transaction inside `em.transactional(...)` —
`allowGlobalContext` stays `false`, reads are wrapped in short transactions, and
repositories are never shared singletons (plan Execution Log, 2026-10-08; do not
"unwire" reads from transactions).

Also (Phase 8, 2026-10-09): `@Public()` (`src/auth/public.decorator.ts`) is now
consumed by the global JWT guard (`JwtGuard` + `RolesGuard` as `APP_GUARD` in
`src/app.module.ts`), and `GET /health/ready` probes SQS in addition to PostgreSQL
(`{postgres:'ok', sqs:'ok'}`, `src/health/sqs-prober.ts`) — `HealthService` grew a
second, `SQS_PROBER`-injected constructor dependency. The app boots with the pino
`PinoLoggerService` and `src/observability/` adds the app-wide correlation
middleware and `GET /metrics`.

*Not implemented — do not assume they exist:*
- `MikroOrmModule.forFeature(...)` is not used — repositories take the injected
  `EntityManager` directly; new entities are registered by adding them to the `entities`
  array in `src/database/mikro-orm.config.ts` (the CLI diffs against that same array).

## Pattern Overview

Keep Bun's *legacy* decorator metadata emit on (`experimentalDecorators` + `emitDecoratorMetadata`),
keep module resolution on `esnext`/`bundler`, inject MikroORM's `EntityManager` through the
**core class token** with an explicit `@Inject(EntityManager)` **value** import, put `driver` on the
`forRootAsync` options object (not only inside the factory), keep entities/migrations in the
shared `src/database/mikro-orm.config.ts` (the zero-entity discovery throw was a Phase 1–2
stopgap — G4), and bootstrap app-level integration tests via **dynamic** `await import()`
after assigning env defaults — then verify with `bun run validate` + `bun test` + `docker compose … --wait`.

## Implementation Steps

### Step 1: TypeScript/Bun configuration — `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "experimentalDecorators": true,   // NestJS legacy decorators + TS typechecking of them
    "emitDecoratorMetadata": true,    // emits __legacyMetadataTS("design:paramtypes", [...])
    "target": "ES2022",
    "module": "esnext",               // node16/commonjs attempts → TS1479 + bun:test resolution failure
    "moduleResolution": "bundler",
    "outDir": "dist", "rootDir": ".", "esModuleInterop": true, "skipLibCheck": true,
    "types": ["bun"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Key points:
- `emitDecoratorMetadata` is the on/off switch for `design:paramtypes` under Bun: verified
  `false` → `Reflect.getMetadata('design:paramtypes', X)` is `undefined`; `true` → emits
  `typeof Dep === "undefined" ? Object : Dep`. Without it Nest cannot resolve *any* constructor DI.
- `experimentalDecorators` selects the legacy decorator path (`__legacyDecorateClassTS` /
  `__legacyMetadataTS`) that Nest's `@Injectable()`/`@Inject()`/`@Get()` are written against.
- Bun **1.3.14 did not apply these two flags** on `bun run` → `paramtypes=[null]` →
  `can't resolve dependencies`. The fix was upgrading Bun to **1.4.2** (plan Execution Log).
  If DI suddenly breaks with `paramtypes=[null]`, check `bun --version` *first*.
- `bun run`/`bun test` never type-check. `bun run validate` (`tsc --noEmit`, TS 7) is the only
  guard that catches token mistakes (TS1361, TS2554) — run it after every change.

### Step 2: Env validation + load order — `src/config/env.validation.ts`

```ts
export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const instance = plainToInstance(EnvSchema, config);
  instance.SQS_ENDPOINT ??= 'http://localhost:4566';
  instance.PORT ??= 3000;
  instance.LOG_LEVEL ??= 'info';
  instance.HOST ??= '127.0.0.1';
  instance.WORKERS_ENABLED ??= true;
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(`Invalid environment configuration — ${details}`);
  return instance;
}
```

Key points:
- `ConfigModule.forRoot({ validate: validateEnv })` runs **synchronously during evaluation of
  `src/app.module.ts`** (`@nestjs/config/dist/config.module.js:53` called from
  `app.module.ts:14`). Any file that **statically** imports `AppModule` therefore validates env
  *before its own module body runs* — verified: with `.env` absent, a static-import spec dies with
  `# Unhandled error between tests … Invalid environment configuration — DATABASE_URL: …`
  (`env.validation.ts:89` ← `config.module.js:53` ← `app.module.ts:14`).
- Consequence: test specs must set `process.env.X ??= …` at the top and import `AppModule`
  **dynamically** inside `beforeAll` (Step 5).
- Bun **auto-loads `.env` from cwd** (verified: `bun -e` in repo root sees `DATABASE_URL`,
  in another cwd it does not) — no `dotenv` package; `.env.example` → `.env` (gitignored) is the
  local contract, the `??=` defaults are the no-`.env` (CI/fresh clone) fallback.
- Always keep `import 'reflect-metadata';` at line 1 of `env.validation.ts` so the
  `class-validator` decorators emit metadata regardless of import order.

### Step 3: MikroORM registration — `src/app.module.ts`

```ts
MikroOrmModule.forRootAsync({
  driver: PostgreSqlDriver,            // ← OUTSIDE the factory: required, see gotcha G3
  useFactory: (config: ConfigService) => ({
    ...mikroOrmConfig,                 // ← entities/migrations/schemaGenerator from src/database/mikro-orm.config.ts
    dbName: config.get<string>('DATABASE_NAME') ?? mikroOrmConfig.dbName,
    user: config.get<string>('DATABASE_USER') ?? mikroOrmConfig.user,
    password: config.get<string>('DATABASE_PASSWORD') ?? mikroOrmConfig.password,
    host: config.get<string>('DATABASE_HOST') ?? mikroOrmConfig.host,
    port: config.get<number>('DATABASE_PORT') ?? mikroOrmConfig.port,
  }),
  inject: [ConfigService],
}),
```

Key points:
- `driver` must appear on the `forRootAsync` options object. `MikroOrmCoreModule.createEntityManager`
  is called *before* DI exists; it prefers the `driver` hint and only falls back to
  `await options.useFactory()` **with no arguments**.
- Options live in `src/database/mikro-orm.config.ts` (spread by the factory) because the
  `mikro-orm` CLI reads the same file — one source of truth for entities and migrations.
  Add new entities to its `entities` array or the CLI will not diff them.
- The factory layers the discrete `DATABASE_*` vars over the config defaults; `clientUrl` /
  `DATABASE_URL` is **not** consumed by the ORM (known env-contract split — still open
  after Phase 4 — `docs/infrastructure.md` → Deferred gaps).
- `autoLoadEntities` and `discovery: { warnWhenNoEntities: false }` are no longer set:
  entities exist since Phase 3 (they were Phase 1–2 stopgaps — see gotcha G4).

### Step 4: Injecting the EntityManager — any new `@Injectable()` service

```ts
// src/health/health.service.ts (current shape; second dependency added Phase 8 / T047)
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';   // VALUE import — not `import type`
import { SQS_PROBER } from './sqs-prober';

@Injectable()
export class HealthService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,   // L7
    @Inject(SQS_PROBER) private readonly sqs: SqsProber,
  ) {}
  async ready(): Promise<{ postgres: 'ok'; sqs: 'ok' }> {
    try { await this.em.getConnection().execute('SELECT 1'); }
    catch (error) {
      throw new ServiceUnavailableException('PostgreSQL unreachable', { cause: error });
    }
    try { await this.sqs.probe(); }
    catch (error) {
      throw new ServiceUnavailableException('SQS unreachable', { cause: error });
    }
    return { postgres: 'ok', sqs: 'ok' };
  }
}
```

Key points:
- For the **default (unnamed)** connection, `@mikro-orm/nestjs` registers the provider under the
  **`EntityManager` class token** (`mikro-orm.providers.js:43` → `provide: contextName ? token : entityManager`;
  exported at `mikro-orm-core.module.js:71`). `@Inject(EntityManager)` matches it exactly.
- The import used in `@Inject(...)` must be a **value** import; see gotcha G2 for the three
  failure modes of `import type`.
- For a *named* context (`contextName: 'x'`), the token becomes `` `${name}_EntityManager` ``
  (`mikro-orm.common.js:30`) and only then is `@InjectEntityManager('x')` correct.

### Step 5: App-level integration/e2e harness — `tests/integration/bootstrap.spec.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';

process.env.DATABASE_URL ??= 'postgres://postgres:local@localhost:5432/wagering';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/wagering';
process.env.KEYCLOAK_AUDIENCE ??= 'wagering-api';

describe('bootstrap (AppModule)', () => {
  let app: INestApplication | undefined; let baseUrl = '';
  beforeAll(async () => {
    const { NestFactory } = await import('@nestjs/core');        // dynamic — see G5
    const { AppModule } = await import('../../src/app.module');  // dynamic — see G5
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');                            // loopback, see L346
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP AddressInfo from listen(0)');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;                // no `as` cast needed
  }, 15_000);                                                     // cold-start headroom
  afterAll(async () => { await app?.close(); }, 15_000);

  it('GET /health/live returns 200 {status:ok}', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
```

Key points:
- **Top-of-file `??=` defaults + dynamic `import()` inside `beforeAll` are both mandatory**
  (defaults first so validation passes; dynamic so they run *before* `AppModule` is evaluated).
  This harness applies to specs that boot the Nest app (HTTP/e2e). DB-only integration
  specs (`tests/integration/schema.spec.ts`, `repositories.spec.ts`, `entities/*.spec.ts`)
  do **not** boot `AppModule`: they call `MikroORM.init(...)` directly against the local
  compose PostgreSQL (hard-coded local credentials) and clean up with `TRUNCATE`/`DELETE` —
  see the raw-SQL/locking pattern doc.
- `import type { INestApplication }` is correct here — it is used only in a type position
  and carries no token (the `address()` narrowing guard needs no `as` cast).
- `logger: false` keeps assertion output readable; `listen(0, '127.0.0.1')` + `address().port`
  avoids port clashes when specs run in parallel and never binds beyond loopback.
- Unit tests bypass DI entirely: construct the service with a hand-rolled stub, e.g.
  `{ getConnection: () => ({ execute }) } as unknown as EntityManager` (see
  `tests/unit/health/health.service.spec.ts`).

### Step 6: Verification recipe (config artifacts vs behavior slices)

- **Config artifacts** are proven by commands, not tests:
  - `bun run validate` → exit 0 (types + decorator-token mistakes)
  - `docker compose config -q && docker compose up -d --wait && docker compose ps` → all healthy
  - `bun --version` ≥ `1.4.2` when DI behaves oddly
- **Behavior slices** are proven by RED→GREEN: write the spec first, watch it fail for the
  *right* reason, then implement (e.g. Phase 1: `env.validation.spec.ts` → `health.service.spec.ts`
  → `exception.filter.spec.ts` → `bootstrap.spec.ts`).
- Evidence format for the plan's Execution Log: command → exit code / counts, plus the
  dev smoke (`bun run dev` + `GET /health/live`, `GET /health/ready`).

## Complete Example (wiring a new DB-backed service)

```ts
// 1. token: value import + @Inject(EntityManager)          → src/bets/bets.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
@Injectable()
export class BetsService {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}
}

// 2. entity registration: add the entity to `entities` in src/database/mikro-orm.config.ts
//    (single source of truth for Nest DI *and* the mikro-orm CLI diff — no forFeature needed)
// 3. spec (unit): new BetsService({ getConnection: () => ({ execute }) } as unknown as EntityManager)
// 4. spec (integration): copy tests/integration/bootstrap.spec.ts harness (env ??= + dynamic import)
// 5. gates: bun run validate && bun test
```

## Gotchas (all verified in Phases 1–3)

- **G1 — Bun decorator flags.** `emitDecoratorMetadata: false` → no `design:paramtypes` at all
  (Nest: `can't resolve dependencies`). Bun `1.3.14` ignored the flags at runtime
  (`paramtypes=[null]`); `1.4.2` emits correctly. Keep both flags + Bun ≥ 1.4.2.
- **G2 — `import type` breaks DI three ways.** With `import type { EntityManager }`:
  (a) `@Inject(EntityManager)` → runtime `ReferenceError: EntityManager is not defined`
  (Bun strips the import; `bun run validate` reports **TS1361**);
  (b) constructor typed only, no `@Inject` → metadata degrades to `[Object]` → *silent* DI failure;
  (c) only safe for pure type annotations (`INestApplication`, `Request`/`Response` from
  express).
- **G3 — `driver` on `forRootAsync` options.** Without it, `createEntityManager()` calls
  `useFactory()` with **no arguments** → `config.get(...)` throws `TypeError` → swallowed
  (`mikro-orm-core.module.js:101–110`) into
  `console.warn('…requires an explicit driver option. See https://github.com/mikro-orm/nestjs/pull/204')`
  and the driver aliases disappear. Measured side-by-side: *without* `driver` → 1 warn,
  providers/exports = `MikroORM`, `EntityManager` only; *with* `driver` → 0 warns,
  providers/exports additionally include `PostgreSqlEntityManager`, `PostgreSqlMikroORM`.
  `@Inject(EntityManager)` keeps working either way; `@Inject(SqlEntityManager)` only with `driver`.
- **G4 — zero entities is a hard error.** `MikroORM.init()` with `entities.length === 0` throws
  `No entities found, please use \`entities\` option` (`Configuration.js:436–437`, default
  `discovery.warnWhenNoEntities: true` despite the "warn" name). `discovery: { warnWhenNoEntities: false }`
  was mandatory for Phases 1–2 (no entities yet) — verified both branches; removed in
  Phase 3 when `src/database/mikro-orm.config.ts` began enumerating entities explicitly.
- **G5 — env is validated at `AppModule` *import* time.** Static `import { AppModule }` in a spec
  → `# Unhandled error between tests` even if you set `process.env` in the module body; dynamic
  `await import('../../src/app.module')` inside `beforeAll` → passes with `.env` removed
  (both directions re-run this session).
- **G6 — `@InjectEntityManager()` is the wrong token here.** `getEntityManagerToken(undefined)`
  yields `` `"undefined_EntityManager"` `` (`mikro-orm.common.js:30`) while the provider is
  registered under the `EntityManager` class; `bun run validate` reports **TS2554** (expects 1
  arg) for the no-arg form, but a *misnamed* context (e.g. `@InjectEntityManager('default')`)
  compiles fine and fails only at container build.
- **G7 — image pins.** `localstack/localstack:4.13.1` (newer releases refuse to start without
  `LOCALSTACK_AUTH_TOKEN`) and `quay.io/keycloak/keycloak:26.8` (tag `26` does not exist).
- **G8 — port 5432 conflicts.** A native PostgreSQL Windows service on 5432 collides with the
  Docker `postgres` service; the Docker stack owns 5432 and `DATABASE_URL` stays `localhost:5432`.

## Project-Specific Constraints

- [ ] `tsconfig.json` keeps `experimentalDecorators` **and** `emitDecoratorMetadata`, `module: esnext`,
      `moduleResolution: bundler`, `types: ["bun"]` — do not "modernize" to `nodenext` (TS1479 + `bun test` breaks).
- [ ] Every DB-touching service uses `@Inject(EntityManager)` with a **value** import from `@mikro-orm/core`.
- [ ] `MikroOrmModule.forRootAsync` carries `driver: PostgreSqlDriver` on the options object;
      all other options spread from `src/database/mikro-orm.config.ts` — never inline a second
      copy (entities/migrations) in `app.module.ts`; new entities go into that file's `entities`
      array.
- [ ] New **required** env vars go in `EnvSchema` + `.env.example` + the `??=` block of every
      app-level integration spec (3 places; DB-only specs hard-code local credentials and have
      no `??=` block); new **optional** vars additionally get a `??=` default in
      `validateEnv` (required vars must fail boot, so they get no default).
- [ ] App-level integration specs (those booting `AppModule`): env `??=` at file top, dynamic
      `import()` of `AppModule` in `beforeAll`, `listen(0, '127.0.0.1')`, `app.close()` in
      `afterAll`. DB-only integration specs skip the Nest harness — `MikroORM.init()` against
      local compose PG instead (raw-SQL/locking pattern doc).
- [ ] `package.json` keeps `"engines": { "bun": ">=1.4.2" }` — the decorator-metadata floor (G1).
- [ ] Compose ports and the app listener stay loopback by default: compose `127.0.0.1:PORT:PORT`
      bindings + `HOST=127.0.0.1` (opt into `0.0.0.0` explicitly, never via code default).
- [ ] Error responses follow the pinned body contract in `src/common/http/exception.filter.ts`
      (`{ statusCode, code, message, failureCode?, status?, transactionId?,
      idempotentReplay?, errors?, correlationId? }` — Phase 4 rewrite, T028): extend the
      contract deliberately; never spread `getResponse()` into the client response, keep
      `statusCode` from `getStatus()`, and keep ≥500 messages masked (503 exempt — the
      pinned operator health hint).
- [ ] Every change passes `bun run validate` (Bun itself never type-checks) and `bun test`.
- [ ] Compose changes pass `docker compose config -q` and `docker compose up -d --wait`.

## Anti-Patterns (What NOT to Do)

- ❌ Don't remove `experimentalDecorators`/`emitDecoratorMetadata` as "deprecated TS flags" — Nest
  and Bun's `__legacyMetadataTS` path need them; DI dies silently.
- ❌ Don't `import type { EntityManager }` in a file that injects it (G2).
- ❌ Don't call `@InjectEntityManager()` / invent context names — use `@Inject(EntityManager)` (G6).
- ❌ Don't move `driver: PostgreSqlDriver` into the factory result only (G3).
- ❌ Don't statically `import { AppModule }` in tests, and don't set `process.env` in `beforeAll`
  before importing it (G5).
- ❌ Don't spin up DI in unit tests — instantiate the class with a stub EM
  (`as unknown as EntityManager`) as `tests/unit/health/health.service.spec.ts` does.
- ❌ Don't use unpinned `localstack:latest` or Keycloak tag `26` (G7).
- ❌ Don't assert global enhancer wiring with `app.get(APP_FILTER)` — under Bun 1.4.2 +
  Nest 12 the process exits **silently** (code 1, no error) inside that lookup. Read
  `app.get(ApplicationConfig).getGlobalFilters()` / `.getGlobalPipes()` instead
  (deep import `@nestjs/core/application-config` — allowed by the package `exports`
  map), as `tests/integration/bootstrap.spec.ts` does.
- ❌ Don't put the `headersSent` guard before logging in exception filters — log first
  (line + `cause` + stack), then skip only the response write; otherwise post-stream
  failures vanish without a trace.

## Related Patterns / Docs

- `docs/solutions/patterns/backend/mikro-orm-v7-raw-sql-locking-and-db-managed-columns.md` —
  raw SQL (`em.execute` + `?`), transaction affinity, DB-managed column stripping, lock tests
  (Phases 2–3 companion to this doc)
- `docs/plans/20261006111327-full-wagering-processor-plan.md` — Phase 1–4 tasks + Execution Log (evidence format)
- `docs/infrastructure.md` — migration commands, env-contract split, Deferred gaps
- `.opencode/skills/nestjs-conventions/SKILL.md`, `.opencode/skills/bullmq/SKILL.md` (Phases 6–7)
- `.opencode/skills/typeorm/SKILL.md` → migration discipline analogue for `@mikro-orm/migrations`
- Future: `docs/solutions/patterns/backend/` — paginated list endpoints, outbox/SQS pipeline patterns

## Safe Change Checklist for Future AI Work

1. **`tsconfig.json` / `package.json`** — re-run `bun run validate`; confirm `bun --version` ≥ 1.4.2
   if constructor DI errors appear.
2. **`src/app.module.ts` / `src/database/mikro-orm.config.ts`** — if you touch
   `MikroOrmModule.forRootAsync`, keep `driver` (options level) and the `mikroOrmConfig` spread
   (no duplicated options; entities/migrations live in that one file); then boot `bun run dev`
   and hit `/health/ready`.
3. **New service/controller** — value-import + `@Inject(EntityManager)`; add the module to
   `AppModule.imports` (or a parent module) before wiring the controller.
4. **New env var** — required: `EnvSchema` → `.env.example` → all app-level integration-spec
   `??=` blocks; optional: additionally a `??=` default in `validateEnv` (cross-file sync;
   forgetting the spec block breaks CI without `.env`).
5. **New test** — unit first (stub constructor args); app-level: integration harness copied from
   `tests/integration/bootstrap.spec.ts` (dynamic import, `listen(0, '127.0.0.1')`,
   15s `beforeAll` timeout); DB-level: `MikroORM.init()` harness copied from
   `tests/integration/repositories.spec.ts` (`TRUNCATE` cleanup, `em.clear()` after rejected flush).
6. **Gates (fresh evidence)**: `docker compose up -d --wait` (3/3 healthy) →
   `bun run validate` (exit 0) → `bun test` (0 fail) →
   `docker compose config -q` (exit 0) → optional `bun run dev` smoke of `/health/live`, `/health/ready`.
