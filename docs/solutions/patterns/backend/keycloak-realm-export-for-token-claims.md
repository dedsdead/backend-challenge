---
title: "Keycloak 26 Realm Export for Token-Claim Fidelity — Project Pattern"
problem_type: pattern
category: backend
components:
  - backend
tags:
  - patterns
  - keycloak
  - keycloak-26
  - realm-export
  - oidc
  - client-scopes
  - protocol-mappers
  - audience
  - direct-grant
  - token-claims
  - local-idp
module: wagering-processor
date: 2026-10-09
established_in: "Phase 8 (Auth & Observability — T043) of docs/plans/20261006111327-full-wagering-processor-plan.md, 2026-10-09"
---

# Pattern: Keycloak 26 Realm Export for Token-Claim Fidelity

## Problem / When to Use This

`keycloak/realm-export.json` is the **file-based source of truth** for the local `wagering`
realm: roles, clients, client scopes, protocol mappers, and test users. It is imported by the
`keycloak` compose service (`start-dev --import-realm`) and consumed by the app's guards
(`src/auth/jwt.guard.ts` verifies `iss`/`aud`; `src/auth/roles.guard.ts` reads
`realm_access.roles`) and by every authenticated test suite (`tests/helpers/keycloak-token.ts`).
Every failure mode of a bad export is either **silent** (tokens minted without `sub`,
`aud`, `preferred_username`, or `realm_access.roles` — only warnings in the Keycloak log) or
**catastrophic for the whole import** (one malformed protocol mapper aborts the file). Use this
pattern whenever you add/change a client, client scope, protocol mapper, realm role, or test
user, or when a token "suddenly" comes back without a claim the guards need.

## Source of Truth Files

- `keycloak/realm-export.json` — the realm itself (single JSON **object**, 687 lines):
  `roles.realm` (L12–L23), `clientScopes` (L24–L560: hand-authored `audience-wagering-api`
  L26–L47, extracted builtin `basic` L49–L82, `roles` L84–L132, `profile` L134+),
  `clients` (L561–L610: `wagering-api` L563, `wagering-cli` L580), `users` (L611–L686)
- `docker-compose.yml` → `keycloak` service (L30–L49): image `quay.io/keycloak/keycloak:26.8`,
  `command: start-dev --import-realm`, read-only mount
  `./keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json:ro`, **no named
  volume** (the `volumes:` section declares only `localstack-data`)
- `tests/unit/keycloak/realm-export.spec.ts` — contract tests on the file's *shape* (8 tests:
  realm/roles/clients/scopes/mappers/users)
- `tests/helpers/keycloak-token.ts` — behavioral verification: password direct grant against
  the `wagering-cli` client, then decode the JWT
- Consumers that define the claim contract:
  `src/auth/jwt.guard.ts` (`KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` env → `jwtVerify`),
  `src/auth/roles.guard.ts` (`request.user.realm_access.roles`)
- `docs/infrastructure.md` → Infrastructure Overview / Keycloak row — the re-import recipe
  (`docker compose up -d --force-recreate keycloak`)
- Session record: `docs/plans/20261006111327-full-wagering-processor-plan.md` →
  "Execution Log" → `2026-10-09 — Phase 8` → T043 (gotchas + live-token evidence)

## Current Implementation Snapshot

- **Shape**: one realm **object** (`{ "realm": "wagering", ... }`), not an array of realms;
  `enabled: true`, `sslRequired: "external"`, `bruteForceProtected: true`.
- **Roles**: `transact:read`, `transact:write` in `roles.realm` — the exact strings the
  controllers pass to `@Roles(...)` and `RolesGuard` compares against.
- **11 client scopes**, including the **extracted Keycloak builtins**
  `basic`, `roles`, `profile`, `email`, `web-origins`, `acr` (+ optional `address`, `phone`,
  `offline_access`, `microprofile-jwt`) and the hand-authored `audience-wagering-api`.
  Claim ownership as imported:
  - `basic` → `oidc-sub-mapper` supplies **`sub`** (since Keycloak 26.3 `sub` lives here)
  - `profile` → `oidc-usermodel-attribute-mapper` (`user.attribute: username`) supplies
    **`preferred_username`**
  - `roles` → `oidc-usermodel-realm-role-mapper` supplies **`realm_access.roles`**
    (`multivalued: true`), plus `oidc-usermodel-client-role-mapper` and
    `oidc-audience-resolve-mapper`
  - `audience-wagering-api` → `oidc-audience-mapper` with
    `included.client.audience: "wagering-api"`, `access.token.claim: "true"`,
    `id.token.claim/introspection.token.claim/userinfo.token.claim: "false"`
- **Every** protocol mapper carries the triple `name` + `protocol: "openid-connect"` +
  `protocolMapper: "oidc-…"`.
- **Clients**:
  - `wagering-api` — `bearerOnly: true`, `directAccessGrantsEnabled: false` (the audience
    target; the app checks `aud=wagering-api`)
  - `wagering-cli` — `publicClient: true`, `directAccessGrantsEnabled: true`,
    `defaultClientScopes: ["web-origins","acr","roles","profile","basic","email",
    "audience-wagering-api"]` — this is the client the test helper authenticates against
    (plan deviation: a bearer-only client cannot do the direct grant, so local token
    acquisition lives on a second client)
- **Users** (all `enabled`, password `wagering-dev-123` `temporary: false`):
  `provider-client` `[transact:read, transact:write]`, `operator` `[read, write]`,
  `read-only-client` `[read]`, `write-only-client` `[write]` — the two single-role users
  exist so both 403 directions can be proven (`tests/integration/auth-observability.spec.ts`).
- **Verification is behavioral, not just structural**: `bun test tests/unit/keycloak` (8 pass)
  proves the file's shape; a live direct grant + base64url decode of the JWT payload proves
  `sub`, `preferred_username`, `aud=wagering-api`, and the right `realm_access.roles`
  (plan Execution Log, "Live-verified" evidence).

## Planned / Optional Extensions (If Applicable)

*Not implemented — do not assume they exist:*
- The realm file is **not** round-tripped from a running Keycloak (no `kc.sh export` step in
  the repo). The file is authored by hand; admin-UI edits are lost on container recreate.
- No client scopes are attached to `wagering-api` itself (`bearerOnly` clients do not obtain
  tokens here) — the audience reaches tokens through `wagering-cli`'s default scopes.
- No Keycloak SSO/browser-flow or required-action config; only the direct grant path is used.

## Pattern Overview

Author `keycloak/realm-export.json` as a single realm object that carries the **extracted
builtin client scopes** Keycloak 26 needs to emit claims, one **fully-keyed** protocol mapper
per claim (`name` + `protocol` + `protocolMapper`), a dedicated **audience scope** using
`oidc-audience-mapper`, a bearer-only API audience client plus a separate public direct-grant
client for tests, and the four role-bearing users — then re-import with
`--force-recreate` and verify by **fetching a real token and decoding its payload**, backed by
the shape assertions in `tests/unit/keycloak/realm-export.spec.ts`.

## Implementation Steps

### Step 1: Realm shape — `keycloak/realm-export.json` (top-level object)

```jsonc
{
  "realm": "wagering",
  "enabled": true,
  "sslRequired": "external",
  "bruteForceProtected": true,
  "roles": { "realm": [ { "name": "transact:read", ... }, { "name": "transact:write", ... } ] },
  "clientScopes": [ ... ],   // L24+
  "clients":     [ ... ],    // L561+
  "users":       [ ... ]     // L611+
}
```

Key points:
- The file must be a **realm object**. An array-shaped export is not what
  `--import-realm` accepts here (T043 gotcha: "realm export must be a realm object, not an
  array").
- Realm role names must match the strings used in `@Roles('transact:write')`
  (`src/modules/wallets/wallets.controller.ts`, `src/modules/wagering/wagering.controller.ts`)
  character-for-character — `RolesGuard` does an exact `includes()` on
  `realm_access.roles`.
- Keep the file at `keycloak/realm-export.json` — the compose mount path is fixed
  (`docker-compose.yml:39`).

### Step 2: Extracted builtin scopes (the claim-fidelity core)

```jsonc
{
  "name": "basic",
  "protocol": "openid-connect",
  "attributes": { "include.in.token.scope": "false", "display.on.consent.screen": "false" },
  "protocolMappers": [
    {
      "name": "sub",
      "protocol": "openid-connect",     // BOTH keys required — see G3
      "consentRequired": false,
      "config": { "introspection.token.claim": "true", "access.token.claim": "true" },
      "protocolMapper": "oidc-sub-mapper"   // KC 26.3+ carries `sub` here
    }
  ]
}
```

```jsonc
// roles scope — realm roles claim consumed by src/auth/roles.guard.ts
{
  "name": "realm roles",
  "protocol": "openid-connect",
  "config": {
    "user.attribute": "foo",
    "access.token.claim": "true",
    "claim.name": "realm_access.roles",
    "jsonType.label": "String",
    "multivalued": "true"
  },
  "protocolMapper": "oidc-usermodel-realm-role-mapper"
}
```

Key points:
- The builtins `basic`, `roles`, `profile`, `email`, `web-origins`, `acr` must be present in
  `clientScopes` (asserted in `realm-export.spec.ts:65–74`). Without them, imports still
  "succeed" but issued tokens silently lose `sub` / `preferred_username` /
  `realm_access.roles` with only console warnings (G2).
- Copy builtin scopes **verbatim from a Keycloak 26.8 export** — do not trim their mappers;
  `profile` alone carries ~15 `oidc-usermodel-attribute-mapper` entries (L134–L559).
- Every mapper entry needs `name`, `protocol`, and `protocolMapper` (Step 5 / G3).

### Step 3: Audience scope — the `aud` the guard verifies

```jsonc
{
  "name": "audience-wagering-api",
  "protocol": "openid-connect",
  "attributes": { "include.in.token.scope": "true", "display.on.consent.screen": "false" },
  "protocolMappers": [
    {
      "name": "wagering-api audience",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-audience-mapper",       // NOT `oidc-audience` (G4)
      "config": {
        "included.client.audience": "wagering-api",   // must equal KEYCLOAK_AUDIENCE
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "false",
        "userinfo.token.claim": "false"
      }
    }
  ]
}
```

Key points:
- `included.client.audience` must equal the `KEYCLOAK_AUDIENCE` env value
  (`wagering-api`) — `JwtGuard` passes it to `jwtVerify(..., { audience })`, so a mismatch
  turns every request into 401.
- Attach the scope to the **direct-grant client's** `defaultClientScopes`
  (`wagering-cli`, L591–L599) — that is what puts `aud` into the tokens tests actually use.

### Step 4: Clients + users

```jsonc
// audience target — bearer-only, no direct grant
{ "clientId": "wagering-api", "publicClient": false, "bearerOnly": true,
  "directAccessGrantsEnabled": false,
  "attributes": { "access.token.lifespan": "300" } },

// local token acquisition for tests — public + direct grant
{ "clientId": "wagering-cli", "publicClient": true, "bearerOnly": false,
  "standardFlowEnabled": false, "directAccessGrantsEnabled": true,
  "defaultClientScopes": ["web-origins", "acr", "roles", "profile", "basic",
                           "email", "audience-wagering-api"],
  "optionalClientScopes": ["address", "phone", "offline_access", "microprofile-jwt"] }
```

```jsonc
// one of four users; password is non-temporary so the direct grant works unattended
{ "username": "read-only-client", "enabled": true, "emailVerified": true,
  "credentials": [{ "type": "password", "value": "wagering-dev-123", "temporary": false }],
  "realmRoles": ["transact:read"] }
```

Key points:
- Never enable `directAccessGrantsEnabled` on `wagering-api` itself — it is `bearerOnly`
  (G6). The plan's "direct-grant enabled for local testing" is realized on `wagering-cli`.
- `temporary: false` on credentials is required: a temporary password makes the password
  grant fail with `invalid_grant` and the token helper throws with the raw response text.

### Step 5: Re-import + verify (behavioral, not just structural)

```bash
# 1. --import-realm SKIPS an existing realm and there is no data volume:
docker compose up -d --force-recreate keycloak     # or `docker compose down` first
docker compose ps                                  # keycloak must reach "Up (healthy)"

# 2. shape contract (no containers needed):
bun test tests/unit/keycloak/realm-export.spec.ts  # 8 pass

# 3. claim fidelity — fetch a real token and decode the payload:
curl -s -X POST http://localhost:8080/realms/wagering/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=wagering-cli&username=operator&password=wagering-dev-123' \
  | jq -r .access_token | cut -d. -f2 | base64 -d 2>/dev/null | jq '{sub, preferred_username, aud, realm_access}'
```

Key points:
- The decode must show `sub`, `preferred_username`, `aud: "wagering-api"`, and
  `realm_access.roles: ["transact:read","transact:write"]` for `operator`.
- Equivalent programmatic check: `keycloakToken('operator')` from
  `tests/helpers/keycloak-token.ts` + decode (the helper already throws with a useful body
  when the grant fails).
- Full-stack proof after re-import: `bun test tests/integration/auth-observability.spec.ts`
  (13 pass) — exercises 401/403/201 against the imported realm end to end.

## Complete Example (adding a new client scope + role)

```jsonc
// 1. new realm role — keycloak/realm-export.json → roles.realm
{ "name": "wallet:reconcile", "description": "Run reconciliation" }

// 2. new client scope with a fully-keyed mapper (name + protocol + protocolMapper)
{ "name": "reconcile-claims", "protocol": "openid-connect",
  "protocolMappers": [ { "name": "…", "protocol": "openid-connect",
                         "protocolMapper": "oidc-…", "config": { … } } ] }

// 3. grant it to the direct-grant client so test tokens carry it
//    wagering-cli.defaultClientScopes += "reconcile-claims"

// 4. grant the role to a user (and keep one single-role user per direction for 403 tests)
//    users[].realmRoles += "wallet:reconcile"

// 5. enforce it in code: controller handler gets @Roles('wallet:reconcile')
//    (see docs/solutions/patterns/backend/fail-closed-global-jwt-and-roles-guards.md)

// 6. re-import + verify:
docker compose up -d --force-recreate keycloak
bun test tests/unit/keycloak && bun test tests/integration/auth-observability
```

## Gotchas (all verified during Phase 8 / T043)

- **G1 — object, not array.** The export must be a single realm object; an array-shaped file
  does not import (T043 discovery).
- **G2 — missing builtin scopes fail *silently*.** Without the extracted `basic` / `roles` /
  `profile` scopes, Keycloak 26.8 still imports and still issues tokens — minus `sub`
  (moved into `basic` in KC 26.3), `preferred_username`, and `realm_access.roles` — with
  only warnings. Symptom downstream: `JwtGuard` 401s (no usable token) or `RolesGuard` 403s
  on *every* request even with a "valid" token.
- **G3 — every mapper needs `protocol` AND `protocolMapper`.** They are different DB columns
  (`openid-connect` vs the implementation id). Dropping either aborts the whole import with a
  `PROTOCOL_MAPPER_NAME … NULL` constraint error (`realm-export.spec.ts:89–100` pins the
  pair for every mapper in the file).
- **G4 — audience mapper id is `oidc-audience-mapper`**, config key `included.client.audience`
  (not `oidc-audience`, not `audience`). Wrong id → import error or a scope that silently
  adds no `aud`.
- **G5 — re-import needs `--force-recreate`.** `--import-realm` skips an existing realm, and
  the keycloak service has **no named volume** (only `localstack-data` is declared), so
  recreating the container starts clean and re-reads the mount. Editing the file + plain
  `docker compose up -d` changes nothing.
- **G6 — a bearer-only client cannot do the direct grant.** `wagering-api` stays
  `bearerOnly` / `directAccessGrantsEnabled: false`; tests authenticate against the public
  `wagering-cli`. Pointing the token helper at `wagering-api` yields `invalid_grant`.
- **G7 — shape tests ≠ claim tests.** `realm-export.spec.ts` reads the JSON file and proves
  structure; only a live token decode proves claim fidelity (and the live check is what caught
  the KC 26.3 `sub` relocation). Run both after every edit.

## Project-Specific Constraints

- [ ] `keycloak/realm-export.json` stays a single realm object and the compose mount path
      (`/opt/keycloak/data/import/realm-export.json:ro`) stays unchanged.
- [ ] The scopes `basic`, `roles`, `profile`, `email`, `web-origins`, `acr` are present with
      their builtin mappers; clients reference them by name in `defaultClientScopes`.
- [ ] Every `protocolMappers[]` entry carries `name`, `protocol: "openid-connect"`, and a
      `protocolMapper` id starting `oidc-`.
- [ ] Audience is minted by `oidc-audience-mapper` with
      `included.client.audience` == `KEYCLOAK_AUDIENCE` (`wagering-api`).
- [ ] Realm roles are exactly `transact:read` / `transact:write` (the strings in
      `@Roles(...)`); the four test users and their role sets stay in place — single-role
      users exist to prove both 403 directions.
- [ ] After any realm edit: `docker compose up -d --force-recreate keycloak` →
      `bun test tests/unit/keycloak` → live token decode →
      `bun test tests/integration/auth-observability`.
- [ ] Test credentials are local-only dev values (`wagering-dev-123`), never reused outside
      the compose stack.
- [ ] Every change passes `bun run validate` and `bun test`.

## Anti-Patterns (What NOT to Do)

- ❌ Don't edit the realm through the Keycloak admin UI and expect it to stick — the file is
  the source of truth and admin changes vanish on the next `--force-recreate`.
- ❌ Don't "tidy" the export by removing the builtin scopes because the file is long —
  claims disappear **silently** (G2).
- ❌ Don't drop `protocol` (or `protocolMapper`) from a mapper entry, and don't invent mapper
  ids like `oidc-audience` (G3/G4).
- ❌ Don't rely on `docker compose up -d` alone to apply realm edits (G5).
- ❌ Don't enable the direct grant on `wagering-api`, and don't point
  `tests/helpers/keycloak-token.ts` at it (G6).
- ❌ Don't treat `realm-export.spec.ts` green as proof that tokens carry the claims —
  decode a live token too (G7).
- ❌ Don't commit real credentials into the realm file beyond the local dev fixture, and
  don't give test users `temporary: true` passwords (the password grant breaks).

## Related Patterns / Docs

- `docs/solutions/patterns/backend/fail-closed-global-jwt-and-roles-guards.md` — the guards
  that consume this realm's `iss`/`aud`/`realm_access.roles` claims, plus the unit (local
  JWKS) and integration (direct-grant) test harnesses
- `docs/solutions/patterns/backend/pino-log-hygiene-fixture-testing.md` — asserts the
  credentials from this realm never leak into JSON logs
- `docs/solutions/patterns/backend/bootstrap-nestjs-on-bun-mikroorm.md` — compose stack
  (`quay.io/keycloak/keycloak:26.8` pin) and app-level integration harness
- `docs/integrations.md` → Authentication and Access / Integration Catalog #4 — auth model
  and failure modes (`401 UNAUTHORIZED` / `403 ROLE_FORBIDDEN`)
- `docs/infrastructure.md` → Infrastructure Overview (Keycloak row) — re-import recipe,
  token-based suite prerequisites
- Plan tasks: T043 (realm export), T044 (guards), T048 (auth integration tests)

## Safe Change Checklist for Future AI Work

1. **Edit `keycloak/realm-export.json`** — keep the single-object shape; every mapper keeps
   `name`/`protocol`/`protocolMapper`; builtin scopes stay intact.
2. **Sync the claim consumers** — if you rename a role: `@Roles(...)` in
   `src/modules/wallets/wallets.controller.ts` / `src/modules/wagering/wagering.controller.ts`
   + `roles.guard` expectations + user `realmRoles`; if you rename the audience client:
   `KEYCLOAK_AUDIENCE` in `.env.example` and every integration spec's `??=` block.
3. **Re-import**: `docker compose up -d --force-recreate keycloak` (G5), wait for healthy.
4. **Verify**: `bun test tests/unit/keycloak` (shape) → live token decode (claims) →
   `bun test tests/integration/auth-observability` (end-to-end 401/403/201).
5. **Gates (fresh evidence)**: `bun run validate` (exit 0) → `bun test` (0 fail) →
   `docker compose config -q` (exit 0) if compose changed.
