---
title: "Pino Fixture Log-Hygiene Testing (Sink + Redaction + Correlation) — Project Pattern"
problem_type: pattern
category: backend
components:
  - backend
tags:
  - patterns
  - pino
  - logging
  - redaction
  - log-hygiene
  - correlation-id
  - async-local-storage
  - nest-logger-service
  - test-fixture
  - observability
module: wagering-processor
date: 2026-10-09
established_in: "Phase 8 (Auth & Observability — T045/T048) of docs/plans/20261006111327-full-wagering-processor-plan.md, 2026-10-09"
---

# Pattern: Pino Fixture Log-Hygiene Testing (Sink + Redaction + Correlation)

## Problem / When to Use This

The service must emit structured JSON logs that **never** contain authorization headers,
bearer tokens, or financial payloads (README §12 / plan T045), and every HTTP log line must be
traceable via a correlation id (`cid=` / `x-correlation-id`). Assertions about *what a log
line contains or must not contain* cannot be made against stdout (the app writes JSON through
a `LoggerService` adapter, suites run in-process, and pino flushes asynchronously). Use this
pattern whenever you (a) add a redaction rule or a new log statement that could carry
sensitive data, (b) need to assert log content in a test — hygiene (no token leakage) or
presence (a `cid=` for a rejected request), or (c) need to know which logger a suite is
actually using (`logger: false` vs an injected sink).

## Source of Truth Files

- `src/observability/logger.ts` — `SERVICE_NAME` (L5), `REDACT_PATHS` (L14–L19),
  `loggerOptions`/`createLogger` (L26–L35), process-wide `pinoLogger` (L38),
  `PinoLoggerService` Nest adapter (L46–L102; destination branch at L50)
- `src/observability/correlation.ts` — `CORRELATION_ID_RE` (L8), `getCorrelationId` /
  `runWithCorrelationId` (L13–L18), `correlationIdMiddleware` (L25–L37)
- `src/observability/observability.module.ts` — middleware registered app-wide via
  `forRoutes({ path: '{*splat}', method: RequestMethod.ALL })` (L22–L27)
- `src/common/http/exception.filter.ts` — `cidSuffix` from the validated request header
  (L266–L269) appended to `warn`/`error` messages (L288, L290)
- `src/main.ts` — production wiring: `logger: new PinoLoggerService(), bufferLogs: true`
  (+ `app.flushLogs()`)
- Unit fixtures: `tests/unit/observability/logger.spec.ts` (capture destination, redaction,
  adapter bindings), `tests/unit/observability/correlation.spec.ts` (echo/validate/uuid)
- Integration fixture: `tests/integration/auth-observability.spec.ts` — `LogSink` (L16–27),
  sink injection (L40–42), async-flush poll (L216–221), level-40 warn assertion (L232–236),
  whole-line negative assertions (L238–242)
- Echo behavior: `tests/integration/bootstrap.spec.ts:97–113` (`x-correlation-id` echo,
  malformed-id rejection)
- Session record: plan Execution Log → `2026-10-09 — Phase 8` → T045/T048

## Current Implementation Snapshot

- **Logger**: pino `^10.4.0`, base binding `service: 'wagering-processor'`, level from
  `CreateLoggerOptions.level ?? process.env.LOG_LEVEL ?? 'info'`.
- **Redaction paths** (censor `[Redacted]`): `req.headers.authorization`,
  `*.headers.authorization`, plus bare **and** nested `data` / `payload` / `body`
  (`['data','payload','body', '*.data', '*.payload', '*.body']`), **and nested financial
  fields** (`'*.money', '*.amount', '*.currency', '*.balance', '*.balanceBefore',
  '*.balanceAfter', '*.balance_before', '*.balance_after'`) — the bare forms exist
  because fast-redact's `*.x` does **not** match a top-level `x` (comment `logger.ts:11–12`).
- **`PinoLoggerService`**: implements Nest `LoggerService`; with `{ destination }` it builds
  a **dedicated** logger (`createLogger(options)`), without it it delegates to the
  process-wide `pinoLogger` (`logger.ts:49–51`). Its `write()` maps Nest's varargs to pino
  bindings: string → `context`, `Error` → `err`, object → merged bindings (L81–101).
- **Correlation**: `correlationIdMiddleware` validates/assigns `x-correlation-id`
  (`/^[A-Za-z0-9._-]{1,128}$/`, else `randomUUID()`), echoes it on the response, and stores
  it in `AsyncLocalStorage` for the request scope. Registered from `ObservabilityModule` —
  **not** `main.ts` — so apps built directly from `AppModule` in tests get it too.
- **Where the cid actually appears in log lines today**: (a) the exception filter appends
  ` cid=<validated header>` to its `warn`/`error` **message text** for 4xx/5xx
  (`exception.filter.ts:267/290`); (b) producers pass explicit `{ correlationId, … }`
  bindings (e.g. `src/messaging/wager-transaction.consumer.ts`). `getCorrelationId()` /
  `runWithCorrelationId()` are exported and unit-tested, but as of Phase 8 **no production
  code reads the ALS store yet** — it is the plumbing for future child loggers.
- **Fixtures**: unit specs use a hand-rolled `{ write(chunk) }` destination; the
  integration hygiene test boots the app with
  `logger: new PinoLoggerService({ destination: sink, level: 'info' })` and polls the sink.
  All other app-level suites pass `logger: false` (or set `LOG_LEVEL ??= 'silent'`).

## Planned / Optional Extensions (If Applicable)

*Not implemented — do not assume they exist:*
- Reading `getCorrelationId()` inside the exception filter / use-case / workers so **every**
  line carries `cid` as a binding (today the filter re-reads the header and producers pass
  `correlationId` explicitly).
- `pino-http` request/response logging — the package is in `package.json` but is **not
  wired** anywhere in `src/`; request logging today is the exception filter's lines only.
- Log sampling/rotation or a remote transport (local dev writes to stdout only).

## Pattern Overview

Inject an in-memory pino destination through the app's own `PinoLoggerService` so tests
capture the exact JSON lines production would emit, then assert (1) positively on structure —
`level`, `msg`, `context`, `cid=` — and (2) negatively over **whole raw lines** that no
authorization header, `Bearer ` prefix, or raw token appears anywhere. Keep unit-level
redaction proofs on `createLogger({ destination })` (config in isolation) and app-level
hygiene proofs on the booted app (filter + adapter + middleware together), accounting for
pino's numeric levels (warn = **40**) and its asynchronous flush.

## Implementation Steps

### Step 1: Redaction + adapter config — `src/observability/logger.ts`

```ts
const payloadKeys = ['data', 'payload', 'body'];
const financialKeys = ['money', 'amount', 'currency', 'balance', 'balanceBefore', 'balanceAfter', 'balance_before', 'balance_after'];
const REDACT_PATHS = [
  'req.headers.authorization',
  '*.headers.authorization',
  ...payloadKeys,                    // bare top-level keys (fast-redact `*.x` misses `x`)
  ...payloadKeys.map((key) => `*.${key}`),  // one level down (req/res wrappers)
  ...financialKeys.map((key) => `*.${key}`), // nested financial fields at any depth
];

export const loggerOptions = (options: CreateLoggerOptions = {}): LoggerOptions => ({
  level: options.level ?? process.env.LOG_LEVEL ?? 'info',
  base: { service: SERVICE_NAME },                 // 'wagering-processor'
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
});
```

Key points:
- Redaction rewrites **object fields only**. A token you interpolated into a message string is
  not sanitized — the discipline is "log ids/bindings, never payloads" (see the rejection log
  in `submit-transaction.use-case.ts`: `transactionId`/`walletId`/`providerId`/`failureCode`,
  no body).
- Adding a new sensitive key ⇒ add both `key` and `*.key` forms, or nested-only leakage
  stays covered while top-level leaks (or vice versa) slip through.
- **Financial fields** (`money`, `amount`, `currency`, `balance`, `balanceBefore`,
  `balanceAfter`, `balance_before`, `balance_after`) are redacted at any nesting depth
  via `*.<field>` patterns — this prevents accidental leakage of monetary values in
  structured log bindings (Phase 9 security fix).
- `PinoLoggerService`'s constructor branch matters for tests: `{ destination }` ⇒ private
  logger (fixture-safe), no options ⇒ shared `pinoLogger` (process-wide side effects).

### Step 2: Correlation middleware — `src/observability/correlation.ts` + module registration

```ts
export const CORRELATION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function correlationIdMiddleware(req, res, next): void {
  const inbound: unknown = req.headers?.['x-correlation-id'];
  const correlationId = typeof inbound === 'string' && CORRELATION_ID_RE.test(inbound)
    ? inbound : randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  storage.run({ correlationId }, () => next());   // AsyncLocalStorage scope = request scope
}

// observability.module.ts — Express 5 / path-to-regexp v8: named wildcard catch-all
consumer.apply(correlationIdMiddleware)
  .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
```

Key points:
- Register on the **module** (`ObservabilityModule.configure`), not in `main.ts` — test
  harnesses boot `AppModule` directly and would otherwise skip the middleware entirely.
- Path must be the named wildcard `'{*splat}'`; plain `'*'` / `'/'` is invalid under
  path-to-regexp v8 (comment `observability.module.ts:23–24`).
- Inbound ids are validated with the same regex the exception filter uses before putting
  `cid=` into a log line (`exception.filter.ts:267`) — a malicious 200-char header can't shape
  log/response content (`bootstrap.spec.ts:110–112` pins the rejection).

### Step 3: Unit fixture — capture destination, assert config in isolation

```ts
// tests/unit/observability/logger.spec.ts
const capture = () => {
  const chunks: string[] = [];
  const destination = { write: (chunk: string) => { chunks.push(chunk); } };
  return { chunks, destination };
};

it('redacts the authorization header, data, payload and body paths', () => {
  const { chunks, destination } = capture();
  const logger = createLogger({ destination });
  logger.info({ req: { headers: { authorization: 'Bearer super-secret-token' } },
                data: { amount: '100.00' } }, 'request');
  const output = chunks.join('');
  expect(output).not.toContain('super-secret-token');
  expect(output).toContain('[Redacted]');
  expect(JSON.parse(output.trim()).req.headers.authorization).toBe('[Redacted]');
});
```

Key points:
- Assert on the **raw string** (`chunks.join('')`) for negatives — that covers every line and
  every binding, not just the field you remembered to parse.
- `level` on captured lines is **numeric**: `info → 30`, `warn → 40` (`logger.spec.ts:21`).
- Keep these tests at `createLogger` level — no Nest app, no containers, milliseconds to run.

### Step 4: App fixture — inject the sink into `NestFactory.create`

```ts
// tests/integration/auth-observability.spec.ts
class LogSink {
  chunks: string[] = [];
  write(chunk: unknown): void { this.chunks.push(String(chunk)); }
  lines(): string[] {
    return this.chunks.join('').split('\n').filter((line) => line.trim().length > 0);
  }
}

beforeAll(async () => {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');          // dynamic import (G5 of bootstrap pattern)
  const { PinoLoggerService } = await import('../../src/observability/logger');
  sink = new LogSink();
  const app = await NestFactory.create(AppModule, {
    logger: new PinoLoggerService({ destination: sink, level: 'info' }),   // ← explicit level
  });
  await app.listen(0, '127.0.0.1');
  …
});
```

Key points:
- This is the **same logger path production uses** (`main.ts` passes `new PinoLoggerService()`),
  so redaction/adapter behavior asserted here is production behavior.
- Pass `level` explicitly: other suites set `process.env.LOG_LEVEL ??= 'silent'`
  (`metrics.spec.ts:13`) and `loggerOptions` reads `LOG_LEVEL` — an ambient env value would
  silently empty the sink.
- Suites that don't assert logs keep `logger: false` — a sink is only worth it when you're
  going to read it (and it costs allocation per line).

### Step 5: The hygiene assertion — poll for flush, then scan whole lines

```ts
// authenticate + drive a filtered (warn) path with a known cid
const before = sink?.lines().length ?? 0;
const res = await fetch(`${baseUrl}/wallets/not-a-uuid`, {
  headers: { authorization: `Bearer ${token}`, 'x-correlation-id': 'authobs-cid-1' },
});
expect(res.status).toBe(400);

// pino may flush asynchronously — poll until the expected line shows up
let lines: string[] = [];
for (let i = 0; i < 100; i++) {
  lines = sink?.lines() ?? [];
  if (lines.some((line) => line.includes('cid=authobs-cid-1'))) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const fresh = lines.slice(before);                       // only lines from *this* request

const parsed = fresh.map((line) => { try { return JSON.parse(line); } catch { return undefined; } });
const warnLine = parsed.find((e) => e && (e['level'] === 40 || e['level'] === 'warn'));
expect(String(warnLine?.['msg'])).toContain('cid=authobs-cid-1');   // cid lives in msg text

for (const line of fresh) {                               // negative hygiene, whole line
  expect(line.toLowerCase()).not.toContain('authorization');
  expect(line).not.toContain('Bearer ');
  expect(line).not.toContain(token);
}
```

Key points:
- **Poll before asserting** — pino's destination write is asynchronous; the fixed
  100 × 20 ms loop (2s cap) turns a flaky "line missing" into a deterministic wait.
- **Slice by index** (`before` … now) so assertions cover only the lines this request
  produced, keeping the test immune to other output.
- The `cid=` appears in the exception filter's **message string**, not as a JSON field —
  search raw lines for `cid=…`, then use the parsed object only for level/msg checks.
- Accept `level === 40 || level === 'warn'`: pino encodes levels numerically by default, and
  `warn` is **40** (50 is `error`).

## Complete Example (assert a new log-hygiene rule end to end)

```ts
// 1. new sensitive field? → logger.ts: add 'secretKey' AND '*.secretKey' to REDACT_PATHS
// 2. unit proof → tests/unit/observability/logger.spec.ts
const { chunks, destination } = capture();
createLogger({ destination }).info({ secretKey: 's3cret' }, 'x');
expect(chunks.join('')).not.toContain('s3cret');
// 3. integration proof → extend the sink suite: drive the code path that would log it,
//    poll for flush (Step 5), then `for (const line of fresh) expect(line).not.toContain(...)`
// 4. if the line should be traceable, include the correlation id: pass
//    `x-correlation-id` on the request and assert `cid=<id>` in the msg (or add a
//    `correlationId` binding via getCorrelationId() once a producer reads the ALS store)
// 5. gates: bun run validate && bun test
```

## Gotchas (all verified during Phase 8 / T045–T048, and Phase 9 security fixes)

- **G1 — pino warn is 40, not 50.** Numeric levels: trace 10, debug 20, info 30, warn 40,
  error 50, fatal 60. Assert `level === 40 || level === 'warn'`; a `=== 50` expectation finds
  only error lines (auth-observability L232–234).
- **G2 — flush is asynchronous.** Immediately reading the sink after the response races pino;
  poll for the expected marker line (L216–221) instead of a single read.
- **G3 — `cid=` is message text, not a binding.** The exception filter builds
  `` `${line}${cidSuffix}` `` (L267/L290). `JSON.parse(line).cid` is `undefined`; search the
  raw string.
- **G4 — ambient `LOG_LEVEL` can silence the sink.** `loggerOptions` falls back to
  `process.env.LOG_LEVEL`, and suites in the same `bun test` run set `'silent'`. Always pass
  `level` explicitly when constructing the fixture logger (Step 4).
- **G5 — redaction never touches message strings.** It only censors configured object paths;
  an interpolated token in `` this.logger.error(`token ${jwt}`) `` leaks in plaintext. Log
  ids, not secrets — then the negative assertions in Step 5 stay trivially true.
- **G6 — bare vs nested redaction paths.** fast-redact `*.x` does not match top-level `x`
  (comment `logger.ts:11–12`); a path list with only `*.data` leaves a top-level `data`
  unredacted.
- **G7 — middleware registration site.** Correlation is applied from `ObservabilityModule`;
  moving it to `main.ts` makes every test-booted app lose `x-correlation-id` echo and ALS
  scope silently.
- **G8 — `getCorrelationId()` is plumbing, not yet a consumer.** Nothing in `src/` reads it
  today; don't assert a `correlationId` *binding* on filter lines — assert the `cid=` text or
  explicitly-passed bindings.
- **G9 — financial fields redaction at any depth.** The `financialKeys` array and `*.<field>`
  patterns (Step 1) ensure monetary values never leak through nested log bindings — this was
  a Phase 9 security fix for redaction gaps.

## Project-Specific Constraints

- [ ] Every `redact` addition updates **both** bare and `*.`-prefixed paths for the key
      (G6); censor stays `'[Redacted]'`.
- [ ] **Financial fields** (`money`, `amount`, `currency`, `balance`, `balanceBefore`,
      `balanceAfter`, `balance_before`, `balance_after`) are redacted via `*.<field>`
      patterns at any nesting depth (Phase 9 security fix).
- [ ] Log statements carry **ids/bindings only** (transactionId, walletId, providerId,
      messageId, failureCode, correlationId) — never request bodies, financial payloads, or
      `Authorization` headers (README §12).
- [ ] Log-hygiene assertions scan **whole raw lines** for negatives, not just the parsed
      `msg`/one field.
- [ ] Fixture loggers pass `destination` **and** an explicit `level` (G4); production keeps
      `new PinoLoggerService()` in `main.ts` (bufferLogs + flushLogs unchanged).
- [ ] Correlation middleware stays registered on `ObservabilityModule` with the
      `'{*splat}'` named-wildcard catch-all (G7); inbound ids validated by
      `CORRELATION_ID_RE` before echoing or logging.
- [ ] `cid=` assertions poll for async flush before slicing/asserting (G2).
- [ ] Every change passes `bun run validate` (Bun never type-checks) and `bun test`.

## Anti-Patterns (What NOT to Do)

- ❌ Don't assert `level === 50` for a warn line (G1) or read the sink once without polling
  (G2) — both produce intermittent "works locally" failures.
- ❌ Don't strip a redaction path while "simplifying" `loggerOptions` — leakage resumes
  immediately and only the Step-5 negative scan would catch it.
- ❌ Don't log raw tokens/headers/financial payloads and rely on redaction to save you —
  redaction doesn't sanitize strings (G5).
- ❌ Don't register the correlation middleware in `main.ts` (G7), and don't hand-roll a
  second correlation mechanism (the exception filter reuses `CORRELATION_ID_RE`).
- ❌ Don't assert only the parsed warn line when the claim is "no token anywhere" — bindings
  on *other* lines are exactly where leaks hide (Step 5 whole-line loop).
- ❌ Don't wire `pino-http` (declared but unused) or a second logger instance alongside
  `PinoLoggerService` — one adapter, one options source (`loggerOptions`).
- ❌ Don't change the `cid=` format in `exception.filter.ts` without updating the specs that
  grep for `cid=` (`auth-observability.spec.ts:219`, filter unit spec).
- ❌ Don't omit `*.<financial-field>` patterns from `REDACT_PATHS` — nested monetary values
  will leak through structured bindings (G9).

## Related Patterns / Docs

- `docs/solutions/patterns/backend/fail-closed-global-jwt-and-roles-guards.md` — the tokens
  this pattern proves never reach the logs (and the `authed` helper the fixture suite uses)
- `docs/solutions/patterns/backend/keycloak-realm-export-for-token-claims.md` — where the
  credentials under test come from
- `docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md` — dynamic-import app
  harness + env `??=` rules the fixture `beforeAll` follows; `PinoLoggerService` already
  noted there as the production logger
- `docs/integrations.md` (auth/failure modes), `docs/architecture.md` /
  `docs/glossary.md` — observability surface updated in Phase 8
- Plan tasks: T045 (logger + correlation), T048 (log-hygiene integration test)

## Safe Change Checklist for Future AI Work

1. **New log statement** → bindings only (ids, status, failureCode); never payload/header
   values (G5); include `correlationId`/`transactionId`/`messageId` where available.
2. **New sensitive field** → `logger.ts` `REDACT_PATHS` (bare + `*.` pair) → unit redaction
   test → extend the sink suite's negative scan.
3. **New financial field** → add to `financialKeys` array in `logger.ts` (auto-expands to
   `*.<field>` patterns) → unit redaction test → extend the sink suite's negative scan.
4. **New assertion on log content** → copy the Step-5 recipe: sink injection with explicit
   `level`, marker-line poll, `slice(before)`, raw-line negatives, `level === 40 || 'warn'`.
5. **Touching correlation** → keep module-level registration + `'{*splat}'` + shared
   `CORRELATION_ID_RE`; update `correlation.spec.ts` and `bootstrap.spec.ts` echo tests.
6. **Gates (fresh evidence)**: `bun run validate` (exit 0) → `bun test tests/unit/observability`
   → `bun test tests/integration/auth-observability` (13 pass) → full `bun test` (0 fail).
