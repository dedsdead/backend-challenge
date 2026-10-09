/**
 * Direct-grant token helper for integration suites (plan T048).
 *
 * Fetches bearer tokens for the four users defined in keycloak/realm-export.json
 * from the local Keycloak container (client `wagering-cli`, password
 * `wagering-dev-123`) and caches them until shortly before expiry.
 */

const BASE = process.env.KEYCLOAK_BASE ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'wagering';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'wagering-cli';
const PASSWORD = process.env.KEYCLOAK_TEST_PASSWORD;

export type KeycloakUser =
  | 'provider-client'
  | 'operator'
  | 'read-only-client'
  | 'write-only-client';

const cache = new Map<string, string>();

function expiresAtMs(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

export async function keycloakToken(user: KeycloakUser | string): Promise<string> {
  if (!PASSWORD) {
    throw new Error('KEYCLOAK_TEST_PASSWORD environment variable must be set');
  }
  const cached = cache.get(user);
  if (cached && expiresAtMs(cached) - Date.now() > 30_000) return cached;

  const res = await fetch(
    `${BASE}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        username: user,
        password: PASSWORD,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Keycloak direct grant failed for '${user}': ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error(`Keycloak returned no access_token for '${user}'`);
  }
  cache.set(user, body.access_token);
  return body.access_token;
}

/** `{ authorization: 'Bearer <jwt>' }` for spreading into fetch headers. */
export async function bearer(
  user: KeycloakUser | string = 'operator',
): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await keycloakToken(user)}` };
}
