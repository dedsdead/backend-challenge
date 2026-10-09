---
title: "Fail-Closed Global JWT + Roles Guards (APP_GUARD) — Project Pattern"
problem_type: pattern
category: backend
components:
  - backend
tags:
  - patterns
  - auth
  - jwt
  - jwks
  - jose
  - keycloak
  - guards
  - app-guard
  - roles
  - rbac
  - fail-closed
  - public-endpoint
  - integration-testing
module: wagering-processor
date: 2026-10-09
established_in: "Phase 8 (Auth & Observability — T044/T048) of docs/plans/20261006111327-full-wagering-processor-plan.md, 2026-10-09"
---

# Pattern: Fail-Closed Global JWT + Roles Guards (APP_GUARD)

## Problem / When to Use This

Every HTTP route in this service must be authenticated and authorized by default: no token →
`401 UNAUTHORIZED`, wrong/insufficient role → `403 ROLE_FORBIDDEN`, and **any** verification
failure (missing header, bad signature, expired, wrong `iss`/`aud`, unreachable JWKS) must
fail **closed** into 401 rather than leaking into business logic or surfacing as 500. Use this
pattern when you add a new controller/route (it is dark until you decorate it), when you add
an unauthenticated endpoint (health, metrics — explicitly `@Public()`), when you add a new
realm role, or when you write tests that must call guarded routes. The auth model is
prescribed by `docs/integrations.md` → Authentication and Access; the guards are the only
place it is enforced.

## Source of Truth Files

- `src/auth/public.decorator.ts` — `IS_PUBLIC_KEY` metadata (`SetMetadata`) — the escape
  hatch read by **both** guards
- `src/auth/roles.decorator.ts` — `ROLES_KEY` + `Roles(...roles)` (L3–L10)
- `src/auth/jwt.guard.ts` — `JwtGuard`: Bearer parse (L37), `jwtVerify` with
  issuer+audience (L40–L51), JWKS cache per issuer (L54–64), fail-closed `catch →
  UnauthorizedException` (L49–51)
- `src/auth/roles.guard.ts` — `RolesGuard`: `@Public` skip (L29–30), missing `@Roles` → 403
  (L36), `realm_access.roles` any-of check (L38–45)
- `src/app.module.ts` — registration: `{ provide: APP_GUARD, useClass: JwtGuard }` then
  `{ provide: APP_GUARD, useClass: RolesGuard }` (L54–L55), **in that order**
- Route annotations: `src/modules/wallets/wallets.controller.ts` and
  `src/modules/wagering/wagering.controller.ts` (`@Roles('transact:write')` on POSTs,
  `@Roles('transact:read')` on GETs); `src/health/health.controller.ts` (L9, L15) and
  `src/observability/metrics.controller.ts` (L17) are `@Public()`
- `src/common/http/exception.filter.ts` — error codes `401: 'UNAUTHORIZED'`,
  `403: 'ROLE_FORBIDDEN'` (L28–L29), so guard throws become the pinned body contract
- Unit tests: `tests/unit/auth/jwt.guard.spec.ts` (local JWKS HTTP server, 9 tests),
  `tests/unit/auth/roles.guard.spec.ts` (5 tests)
- Integration: `tests/helpers/keycloak-token.ts` (direct-grant token cache),
  `tests/integration/auth-observability.spec.ts` (13 tests: public/401/403/happy path),
  suite-local `authedFetch` in `tests/integration/{wallets.http,wagering.http,http-api}.spec.ts`
- Session record: plan Execution Log → `2026-10-09 — Phase 8` → T044/T048

## Current Implementation Snapshot

- **Two guards, one registration pair**: `JwtGuard` (authentication, async, `jose`'s
  `createRemoteJWKSet` + `jwtVerify`) runs first; `RolesGuard` (authorization, sync,
  `Reflector`) runs second and reads `request.user` that `JwtGuard` set
  (`request.user = payload`, `jwt.guard.ts:47`).
- **Fail-closed matrix** (all verified by tests):

  | Situation | Result |
  |---|---|
  | `@Public()` handler | both guards skip; no `req.user` |
  | no/invalid `Authorization` header | 401 `UNAUTHORIZED` |
  | token signature/`exp`/`iss`/`aud` invalid | 401 `UNAUTHORIZED` |
  | JWKS endpoint unreachable | 401 `UNAUTHORIZED` (never 500) |
  | valid token, non-public route **without** `@Roles` | 403 `ROLE_FORBIDDEN` |
  | valid token, required role absent (or token has no `realm_access.roles`) | 403 `ROLE_FORBIDDEN` |
  | valid token + any required role present | passes to the handler with `req.user` set |

- **JWKS**: `createRemoteJWKSet(new URL(\`${issuer}/protocol/openid-connect/certs\`))`,
  memoized on the guard instance keyed by issuer (`jwt.guard.ts:54–64`); issuer/audience come
  from `ConfigService.getOrThrow('KEYCLOAK_ISSUER' | 'KEYCLOAK_AUDIENCE')` (both are
  **required** env vars — `src/config/env.validation.ts` fails boot without them).
- **Dependencies**: `jose@^6.2.12` (`package.json:33`). No `@nestjs/jwt`, no local secret.
- **Unit tests need no Keycloak**: `jwt.guard.spec.ts` spins a `node:http` server that serves
  a JWKS built from a generated RSA key (`generateKeyPair('RS256')` → `exportJWK` →
  `calculateJwkThumbprint` for `kid`), mints tokens with `SignJWT`, and stubs
  `ExecutionContext` + `ConfigService` by hand — 14/14 auth tests pass without containers.
- **Integration tests use real tokens**: `bearer('operator')` /
  `keycloakToken('read-only-client')` from `tests/helpers/keycloak-token.ts` — direct grant
  against `wagering-cli`, cached per user and refreshed only when <30s of lifetime remain
  (decode of `exp`), so per-request call sites stay token-free.

## Planned / Optional Extensions (If Applicable)

*Not implemented — do not assume they exist:*
- Provider/resource scoping (`providerId` bound to the token's client) — explicitly still
  deferred ("the guards authenticate and check `transact:read`/`transact:write`, but nothing
  binds `providerId` to the token" — `docs/integrations.md` → HTTP).
- `resource_access` / client-role checks — `RolesGuard` reads **only**
  `realm_access.roles`.
- Refresh-token or introspection flows; token rotation in tests is cache-expiry based only.

## Pattern Overview

Register `JwtGuard` and `RolesGuard` as an ordered `APP_GUARD` pair in `AppModule` so
authentication/authorization is global by construction; every handler must *opt in* to
visibility with either `@Public()` (skip both guards) or `@Roles(...)` (require realm roles)
— anything else is denied by default. Prove it in two layers: guard unit tests against a
**local JWKS HTTP server** (no containers, full negative matrix) and integration tests that
fetch **real Keycloak tokens** through an expiry-aware cache helper with a suite-local
`authedFetch` wrapper.

## Implementation Steps

### Step 1: Decorators — `src/auth/public.decorator.ts` + `src/auth/roles.decorator.ts`

```ts
// public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

Key points:
- Plain `SetMetadata` — no custom decorators library; both keys are module-level constants so
  guards and tests share them (`Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler)` in unit
  tests).
- `@Public()` is read with `reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])` in
  **both** guards — a class-level `@Public()` marks the whole controller public.

### Step 2: Authentication guard — `src/auth/jwt.guard.ts`

```ts
@Injectable()
export class JwtGuard implements CanActivate {
  private jwks?: { issuer: string; getKey: JWTVerifyGetKey };

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY,
        [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest();
    const header: unknown = request.headers?.authorization;
    if (typeof header !== 'string') throw new UnauthorizedException();
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) throw new UnauthorizedException();

    const issuer = this.config.getOrThrow<string>('KEYCLOAK_ISSUER');
    const audience = this.config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    try {
      const { payload } = await jwtVerify(match[1]!, this.getKey(issuer), { issuer, audience });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException();   // fail closed: bad token AND unreachable JWKS
    }
  }

  private getKey(issuer: string): JWTVerifyGetKey {
    if (!this.jwks || this.jwks.issuer !== issuer) {
      this.jwks = { issuer, getKey: createRemoteJWKSet(
        new URL(`${issuer}/protocol/openid-connect/certs`)) };
    }
    return this.jwks.getKey;
  }
}
```

Key points:
- **Everything untrusted lives inside the `try`** — `jwtVerify` network failures, key
  rotation (`createRemoteJWKSet` refetches on unknown `kid`), malformed tokens all collapse
  to `UnauthorizedException` → 401, per the "IdP/JWKS unreachable → 401, never 500" contract.
- `iss` + `aud` are passed as verify options — jose enforces both; a token minted for another
  audience/issuer is rejected without extra code (covered by `jwt.guard.spec.ts:140–159`).
- The JWKS is memoized **per guard instance per issuer** (guard instances are singletons under
  `APP_GUARD`), so JWKS is fetched once, not per request.
- `request.user = payload` is the hand-off to `RolesGuard` — same request object.

### Step 3: Authorization guard — `src/auth/roles.guard.ts`

```ts
canActivate(context: ExecutionContext): boolean {
  const handler = context.getHandler(); const cls = context.getClass();
  if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, cls])) return true;

  const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, cls]);
  if (!required || required.length === 0) throw new ForbiddenException();   // fail closed

  const user = context.switchToHttp().getRequest().user as AuthedUser | undefined;
  const raw = user?.realm_access?.roles;
  const roles = Array.isArray(raw) ? raw : [];
  if (!required.some((role) => roles.includes(role))) throw new ForbiddenException();
  return true;
}
```

Key points:
- **Missing `@Roles` metadata ⇒ 403** — this is the fail-closed rule that keeps new endpoints
  dark until someone declares their access (verified `roles.guard.spec.ts:67–73`).
- Any-of semantics: one matching required role suffices (`required.some(...)`).
- `realm_access.roles` must be an array; anything else degrades to `[]` → 403 (no throw on
  malformed claims).
- The error carries no message body detail; `HttpExceptionFilter` maps 403 →
  `code: 'ROLE_FORBIDDEN'`.

### Step 4: Global registration — `src/app.module.ts`

```ts
providers: [
  HttpExceptionFilter,
  { provide: APP_FILTER, useExisting: HttpExceptionFilter },
  { provide: APP_GUARD, useClass: JwtGuard },    // ← FIRST: authenticates, sets req.user
  { provide: APP_GUARD, useClass: RolesGuard },  // ← SECOND: authorizes from req.user
  …
]
```

Key points:
- **Order matters**: `APP_GUARD` providers run in registration order. `RolesGuard` consumes
  `request.user`; registering it first would 403 every authenticated route.
- Guards live in `AppModule` (not a feature module) so **every** app instance — including
  integration harnesses that boot `AppModule` directly — gets them. No controller opts in.
- Do **not** also add `@UseGuards(JwtGuard)` on controllers — that would run verification
  twice per request.

### Step 5: Annotate every route — controllers

```ts
// src/modules/wallets/wallets.controller.ts
@Post()            @Roles('transact:write')  async create(...) {}
@Get(':walletId')  @Roles('transact:read')   async get(...) {}
@Get(':walletId/ledger') @Roles('transact:read') async ledger(...) {}
@Post(':walletId/reconciliation') @Roles('transact:write') @HttpCode(200) async reconcile() {}

// src/modules/wagering/wagering.controller.ts
@Post('wagering/transactions') @Roles('transact:write') async submit(...) {}
@Get('wagering/transactions/:transactionId') @Roles('transact:read') async getByTransactionId(...) {}
@Get('providers/:providerId/wagering/transactions/:externalTransactionId') @Roles('transact:read') … {}

// unauthenticated surface (spec §2/§9) — exactly two controllers:
//   src/health/health.controller.ts   @Public() on live + ready
//   src/observability/metrics.controller.ts  @Public() on GET /metrics
```

Key points:
- Convention: **POST ⇒ `transact:write`, GET ⇒ `transact:read`** (matches
  `docs/integrations.md` and the realm roles in `keycloak/realm-export.json`).
- A new handler with **no** decorator is invisible to the outside world (403) — decorate it
  the moment you create it.
- `@Public()` is reserved for health/metrics; never for business routes.

### Step 6: Unit-test guards without Keycloak — `tests/unit/auth/jwt.guard.spec.ts`

```ts
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = (await exportJWK(publicKey)) as JWK;
  kid = await calculateJwkThumbprint(jwk);
  const jwks = { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };
  server = createServer((req, res) => {
    if (req.url?.includes('/certs')) { res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks)); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}/realms/wagering`;          // JWKS = {issuer}/certs
  configStore = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_AUDIENCE: 'wagering-api' };
});

const guard = (): JwtGuard => new JwtGuard(new Reflector(), config);   // no DI container
const sign = (o: { audience?; issuer?; expiresInSeconds? } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(o.issuer ?? issuer)
    .setAudience(o.audience ?? 'wagering-api').setSubject('user-1')
    .setExpirationTime(Math.floor(Date.now() / 1000) + (o.expiresInSeconds ?? 300))
    .sign(privateKey as never);
```

Key points:
- The guard builds its JWKS URL as `` `${issuer}/protocol/openid-connect/certs` `` — the fake
  server only has to answer any path containing `/certs`.
- `ExecutionContext` is a hand-rolled stub (`switchToHttp().getRequest()`, `getHandler()`,
  `getClass()`); metadata that decorators would set is applied explicitly with
  `Reflect.defineMetadata(IS_PUBLIC_KEY | ROLES_KEY, …, handler)` — guards called directly
  never see real decorators.
- Negative matrix to keep: missing header, non-Bearer, wrong audience, expired, wrong issuer,
  unreachable JWKS (point `KEYCLOAK_ISSUER` at a dead port like `127.0.0.1:9`), public skip,
  `req.user` population.

### Step 7: Integration-test with real tokens — helper + `authedFetch`

```ts
// tests/helpers/keycloak-token.ts — direct grant + expiry-aware cache
const cache = new Map<string, string>();
export async function keycloakToken(user: KeycloakUser | string): Promise<string> {
  const cached = cache.get(user);
  if (cached && expiresAtMs(cached) - Date.now() > 30_000) return cached;   // refresh 30s early
  const res = await fetch(`${BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'wagering-cli',
      username: user, password: 'wagering-dev-123' }),
  });
  if (!res.ok) throw new Error(`Keycloak direct grant failed for '${user}': ${res.status} ${await res.text()}`);
  …
}
export async function bearer(user: KeycloakUser | string = 'operator') {
  return { authorization: `Bearer ${await keycloakToken(user)}` };
}

// suite-local wrapper — every request merges the cached headers (wallets.http.spec.ts:32–42)
let auth: Record<string, string> = {};
const authedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  globalThis.fetch(input, { ...init,
    headers: { ...((init?.headers ?? {}) as Record<string, string>), ...auth } });
// beforeAll: auth = await bearer('operator');
```

Key points:
- The wrapper keeps every existing call site unchanged — request bodies/paths stay as-is and
  auth is a header merge. Multi-user suites (`auth-observability.spec.ts:61–69`) use the
  per-call `authed(path, user, init)` variant; the cache makes it cheap.
- Specs must declare the `KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` env in their top-of-file
  `??=` block (same rule as `DATABASE_URL` — see the bootstrap pattern, G5).
- Prerequisite differs from other suites: **Keycloak must be up with the realm imported**,
  not just Postgres/LocalStack (`docs/infrastructure.md` → Token-based suites).

## Complete Example (new endpoint + role, end to end)

```ts
// 1. controller handler — src/modules/wallets/wallets.controller.ts
@Post(':walletId/reconciliation')
@Roles('transact:write')                      // POST ⇒ transact:write; 403 without it
async reconcile(@Param('walletId', ParseUUIDPipe) walletId: string) { … }

// 2. no guard wiring needed — AppModule already registers JwtGuard → RolesGuard (Step 4)

// 3. unit: roles.guard.spec.ts — withRoles(['transact:write'], handler) +
//    expect 403 for a read-only user and for a handler with no metadata
// 4. integration: auth-observability.spec.ts —
//    authed('/wallets', 'read-only-client', { method: 'POST', … }) → 403 ROLE_FORBIDDEN
//    authed('/wallets', 'operator', { method: 'POST', … })          → 201
//    fetch('/metrics')                                              → 200 (public)
// 5. gates: bun run validate && bun test
```

## Gotchas (all verified during Phase 8 / T044–T048)

- **G1 — guard order is part of the contract.** `JwtGuard` must be registered before
  `RolesGuard` (`src/app.module.ts:54–55`); reversed, `RolesGuard` sees no `req.user` and
  403s everything.
- **G2 — no `@Roles` ⇒ 403, by design.** A new endpoint that "should obviously be readable"
  is denied until decorated. This is the fail-closed rule, not a bug — fix by adding the
  decorator, never by loosening the guard.
- **G3 — `@Public()` skips *both* guards**, so `req.user` is `undefined` on public routes.
  Never read the user (or derive anything from the token) on a `@Public()` handler.
- **G4 — JWKS outage is a 401, not a 500**, only because the verify call (including the
  network fetch) sits inside the guard's `try/catch`. Moving `jwtVerify` out of the `try` or
  adding a "log and continue" path reintroduces the leak the contract forbids.
- **G5 — unit tests must seed metadata manually.** Direct `guard().canActivate(stubCtx)`
  bypasses decorators; use `Reflect.defineMetadata(IS_PUBLIC_KEY | ROLES_KEY, …, handler)` and
  a real `Reflector` instance (as both auth specs do).
- **G6 — a valid token can still 403 everywhere** if the realm loses its `roles` scope (no
  `realm_access.roles` claim). Symptom: 401s disappear but every guarded route returns 403 —
  the fix is in `keycloak/realm-export.json`, not in the guard (see the Keycloak realm-export
  pattern, G2).
- **G7 — integration suites now need Keycloak.** Any spec booting `AppModule` and hitting a
  non-public route must fetch a token first (`bearer(...)`); otherwise every request 401s and
  the failure looks like a product bug.
- **G8 — token lifetimes are 300s** (`access.token.lifespan` on both clients). The helper's
  30-second early refresh (`keycloak-token.ts:35`) exists because `bun test` suites can run
  long; don't remove the expiry check or tokens die mid-suite.
- **G9 — `jose` is a runtime dependency** (`package.json:33`); Bun never type-checks, so a
  renamed import surfaces only in `bun run validate`.

## Project-Specific Constraints

- [ ] `JwtGuard` and `RolesGuard` stay registered as `APP_GUARD` **in that order** in
      `src/app.module.ts`; no `@UseGuards` duplication on controllers/modules.
- [ ] Every non-public handler carries `@Roles(...)`; POST ⇒ `transact:write`, GET ⇒
      `transact:read`; `@Public()` exists only on `/health/live`, `/health/ready`,
      `GET /metrics`.
- [ ] Guards verify `iss` + `aud` via remote JWKS (`KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE`,
      both required env) — never a shared secret, never decode-only.
- [ ] All verification failures throw `UnauthorizedException` / `ForbiddenException`; the
      status→code mapping stays in `src/common/http/exception.filter.ts` (`UNAUTHORIZED` /
      `ROLE_FORBIDDEN`) — guards never hand-write response bodies.
- [ ] New app-level HTTP specs: env `??=` block (incl. `KEYCLOAK_*`) at file top, dynamic
      `import('AppModule')` in `beforeAll`, tokens via `tests/helpers/keycloak-token.ts`, and
      a suite-local `authedFetch` wrapper.
- [ ] Guard unit tests stay container-free (local JWKS server + hand-rolled `ExecutionContext`);
      the full negative matrix (G-list in Step 6) remains covered.
- [ ] Every change passes `bun run validate` and `bun test`.

## Anti-Patterns (What NOT to Do)

- ❌ Don't add `@UseGuards(JwtGuard)`/`RolesGuard` at controller or class level — they are
  global; you get double verification and divergent behavior (G1).
- ❌ Don't make `RolesGuard` permissive when `@Roles` metadata is missing ("open by default")
  — that silently converts every undecorated route into a public one (G2).
- ❌ Don't verify with `jwtVerify(token, secret)`, a decode-only check, or by trusting an
  unverified `sub` — verification must be JWKS + `iss` + `aud`.
- ❌ Don't catch-and-continue on JWKS errors, and don't return 500 for auth failures (G4).
- ❌ Don't mark a business route `@Public()` to make a failing test pass — fix the token or
  the role (G3).
- ❌ Don't fetch a fresh token on every request in tests — use `bearer()`/`keycloakToken()`
  (expiry-aware cache) so suites stay fast and token-failure noise stays rare (G7/G8).
- ❌ Don't assume `req.user` exists on `@Public()` routes, and don't log the
  `Authorization` header anywhere (see the log-hygiene pattern).
- ❌ Don't scope roles to `resource_access` client roles without changing `RolesGuard` —
  only `realm_access.roles` is read today.

## Related Patterns / Docs

- `docs/solutions/patterns/backend/keycloak-realm-export-for-token-claims.md` — the realm
  file that produces the `iss`/`aud`/`realm_access.roles` these guards consume (and the
  re-import/verification recipe)
- `docs/solutions/patterns/backend/pino-log-hygiene-fixture-testing.md` — proves credentials
  from these tokens never reach JSON logs
- `docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md` — app-level
  integration harness (env `??=` + dynamic import + `listen(0, '127.0.0.1')`) that Step 7
  builds on, and the `APP_PIPE`/`APP_FILTER` registration style `APP_GUARD` mirrors
- `docs/integrations.md` → Authentication and Access / Failure Modes — the 401/403 contract
  this pattern implements; `docs/environments.md`, `docs/infrastructure.md` (env + token
  suite prerequisites)
- Plan tasks: T044 (guards), T048 (auth tests)

## Safe Change Checklist for Future AI Work

1. **New route** → decorate immediately: `@Roles('transact:read'|'transact:write')`, or
   `@Public()` only if it is on the approved unauthenticated surface (health/metrics).
2. **New role/claim** → realm file first (`keycloak/realm-export.json` → `roles.realm` +
   user `realmRoles`), then the `@Roles(...)` call sites, then the realm-export pattern's
   re-import + live-token verification.
3. **Guard edits** → keep the `try/catch → UnauthorizedException` envelope and the
   missing-`@Roles → 403` rule; update `tests/unit/auth/*` matrix in the same change.
4. **New integration suite** → env `??=` incl. `KEYCLOAK_*`, `bearer('operator')` in
   `beforeAll`, `authedFetch` wrapper; run against a stack with Keycloak healthy + realm
   imported.
5. **Gates (fresh evidence)**: `bun run validate` (exit 0) → `bun test tests/unit/auth` →
   `bun test tests/integration/auth-observability` → full `bun test` (0 fail).
