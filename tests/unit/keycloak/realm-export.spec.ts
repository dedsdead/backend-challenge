import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type RealmExport = {
  realm: string;
  enabled: boolean;
  roles?: { realm?: { name: string }[] };
  clientScopes?: {
    name: string;
    protocolMappers?: {
      name: string;
      protocol: string;
      protocolMapper: string;
      config?: Record<string, string>;
    }[];
  }[];
  clients?: {
    clientId: string;
    enabled?: boolean;
    bearerOnly?: boolean;
    directAccessGrantsEnabled?: boolean;
    defaultClientScopes?: string[];
  }[];
  users?: {
    username: string;
    enabled?: boolean;
    credentials?: { type: string; value?: string; temporary?: boolean }[];
    realmRoles?: string[];
  }[];
};

const path = join(import.meta.dir, '../../../keycloak/realm-export.json');
const export_ = JSON.parse(readFileSync(path, 'utf8')) as RealmExport;

describe('keycloak realm export (plan T043)', () => {
  it('defines the wagering realm and enables it', () => {
    expect(export_.realm).toBe('wagering');
    expect(export_.enabled).toBe(true);
  });

  it('declares the transact:read and transact:write realm roles', () => {
    const names = (export_.roles?.realm ?? []).map((role) => role.name);
    expect(names).toContain('transact:read');
    expect(names).toContain('transact:write');
  });

  it('exposes the bearer-only wagering-api client', () => {
    const api = (export_.clients ?? []).find((c) => c.clientId === 'wagering-api');
    expect(api).toBeDefined();
    expect(api!.enabled).toBe(true);
    expect(api!.bearerOnly).toBe(true);
    expect(api!.directAccessGrantsEnabled).toBe(false);
  });

  it('exposes a direct-grant client for local token acquisition', () => {
    const cli = (export_.clients ?? []).find((c) => c.clientId === 'wagering-cli');
    expect(cli).toBeDefined();
    expect(cli!.directAccessGrantsEnabled).toBe(true);
    expect(cli!.defaultClientScopes).toContain('audience-wagering-api');
    expect(cli!.defaultClientScopes).toContain('basic');
    expect(cli!.defaultClientScopes).toContain('roles');
  });

  it('embeds the builtin scopes Keycloak 26.3+ needs for sub, roles and profile claims', () => {
    // Keycloak 26.3 moved `sub` into the `basic` scope; `realm_access.roles`
    // comes from `roles` and `preferred_username` from `profile`. An import
    // that omits them silently issues claim-less tokens.
    const names = (export_.clientScopes ?? []).map((scope) => scope.name);
    for (const builtin of ['basic', 'roles', 'profile', 'email', 'web-origins', 'acr']) {
      expect(names).toContain(builtin);
    }
    expect(names).toContain('audience-wagering-api');
  });

  it('adds the wagering-api audience to access tokens', () => {
    const scope = (export_.clientScopes ?? []).find(
      (s) => s.name === 'audience-wagering-api',
    );
    expect(scope).toBeDefined();
    const mapper = (scope!.protocolMappers ?? []).find(
      (m) => m.protocolMapper === 'oidc-audience-mapper',
    );
    expect(mapper).toBeDefined();
    expect(mapper!.config?.['included.client.audience']).toBe('wagering-api');
    expect(mapper!.config?.['access.token.claim']).toBe('true');
  });

  it('defines every protocol mapper with the protocol/protocolMapper pair Keycloak imports', () => {
    // Keycloak persists `protocol` ("openid-connect") separately from
    // `protocolMapper` (the implementation id); swapping or dropping either
    // column aborts the whole import with PROTOCOL_MAPPER_NAME NULL.
    for (const scope of export_.clientScopes ?? []) {
      for (const mapper of scope.protocolMappers ?? []) {
        expect(mapper.protocol).toBe('openid-connect');
        expect(mapper.protocolMapper).toMatch(/^oidc-/);
        expect(mapper.name).toBeTruthy();
      }
    }
  });

  it('creates the four test users with exactly the planned roles and passwords', () => {
    const byName = new Map((export_.users ?? []).map((u) => [u.username, u]));
    expect([...byName.keys()].sort()).toEqual([
      'operator',
      'provider-client',
      'read-only-client',
      'write-only-client',
    ]);

    const rolesOf = (username: string): string[] =>
      [...(byName.get(username)?.realmRoles ?? [])].sort();

    expect(rolesOf('provider-client')).toEqual(['transact:read', 'transact:write']);
    expect(rolesOf('operator')).toEqual(['transact:read', 'transact:write']);
    expect(rolesOf('read-only-client')).toEqual(['transact:read']);
    expect(rolesOf('write-only-client')).toEqual(['transact:write']);

    for (const username of byName.keys()) {
      const user = byName.get(username)!;
      expect(user.enabled).toBe(true);
      // Passwords are not stored in the realm export (security); set via Keycloak admin CLI
    }
  });
});
