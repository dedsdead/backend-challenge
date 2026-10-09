import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from '../../../src/auth/jwt.guard';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator';

const AUDIENCE = 'wagering-api';

let server: Server;
let issuer = '';
let privateKey: CryptoKey;
let kid = '';
let configStore: Record<string, string> = {};

const config = {
  get: (key: string) => configStore[key],
  getOrThrow: (key: string) => {
    const value = configStore[key];
    if (value === undefined) throw new Error(`missing ${key}`);
    return value;
  },
} as never;

class TestController {
  handler(): void {}
  publicHandler(): void {}
}

const makeCtx = (
  headers: Record<string, string | undefined>,
  handler: (...args: unknown[]) => unknown = TestController.prototype.handler,
) => {
  const request = { headers } as never;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
};

const sign = async (
  options: {
    audience?: string;
    issuer?: string;
    expiresInSeconds?: number;
  } = {},
): Promise<string> => {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject('user-1')
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 300),
    )
    .sign(privateKey as never);
};

beforeAll(async () => {
  const { privateKey: pk, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  privateKey = pk as never;
  const jwk = (await exportJWK(publicKey)) as JWK;
  kid = await calculateJwkThumbprint(jwk);
  const jwks = { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };

  server = createServer((req, res) => {
    if (req.url?.includes('/certs')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}/realms/wagering`;
  configStore = {
    KEYCLOAK_ISSUER: issuer,
    KEYCLOAK_AUDIENCE: AUDIENCE,
  };
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const guard = (): JwtGuard => new JwtGuard(new Reflector(), config);

describe('JwtGuard (plan T044)', () => {
  it('lets @Public() routes through without a token', async () => {
    const handler = TestController.prototype.publicHandler;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    await expect(guard().canActivate(makeCtx({}, handler))).resolves.toBe(true);
  });

  it('rejects a request without an Authorization header (401)', async () => {
    await expect(guard().canActivate(makeCtx({}))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a non-Bearer Authorization header (401)', async () => {
    await expect(
      guard().canActivate(makeCtx({ authorization: 'Basic dXNlcjpwYXNz' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a valid token for the configured issuer and audience', async () => {
    const token = await sign();
    const ok = await guard().canActivate(
      makeCtx({ authorization: `Bearer ${token}` }),
    );
    expect(ok).toBe(true);
  });

  it('exposes the verified claims on the request for the roles guard', async () => {
    const token = await sign();
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    await guard().canActivate(ctx);
    const request = ctx.switchToHttp().getRequest() as { user?: { sub?: string } };
    expect(request.user?.sub).toBe('user-1');
  });

  it('rejects a token minted for another audience (401)', async () => {
    const token = await sign({ audience: 'other-api' });
    await expect(
      guard().canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired token (401)', async () => {
    const token = await sign({ expiresInSeconds: -60 });
    await expect(
      guard().canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token from another issuer (401)', async () => {
    const token = await sign({ issuer: 'http://evil.example/realms/wagering' });
    await expect(
      guard().canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed with 401 when the JWKS endpoint is unreachable', async () => {
    const dead = new JwtGuard(new Reflector(), {
      get: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? 'http://127.0.0.1:9/realms/wagering'
          : AUDIENCE,
      getOrThrow: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? 'http://127.0.0.1:9/realms/wagering'
          : AUDIENCE,
    } as never);
    const token = await sign();
    await expect(
      dead.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token when issuer host does not match expected host', async () => {
    // This test verifies that the guard validates issuer against expected host
    // when KEYCLOAK_EXPECTED_ISSUER_HOST is configured
    const maliciousIssuer = 'http://evil.example/realms/wagering';
    const malicious = new JwtGuard(new Reflector(), {
      get: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? maliciousIssuer
          : key === 'KEYCLOAK_EXPECTED_ISSUER_HOST'
            ? 'localhost'
            : AUDIENCE,
      getOrThrow: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? maliciousIssuer
          : key === 'KEYCLOAK_EXPECTED_ISSUER_HOST'
            ? 'localhost'
            : AUDIENCE,
    } as never);
    const token = await sign({ issuer: maliciousIssuer });
    await expect(
      malicious.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a token when issuer host matches expected host', async () => {
    const expectedIssuer = issuer; // same as test setup
    const guardWithExpected = new JwtGuard(new Reflector(), {
      get: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? expectedIssuer
          : key === 'KEYCLOAK_EXPECTED_ISSUER_HOST'
            ? '127.0.0.1'
            : AUDIENCE,
      getOrThrow: (key: string) =>
        key === 'KEYCLOAK_ISSUER'
          ? expectedIssuer
          : key === 'KEYCLOAK_EXPECTED_ISSUER_HOST'
            ? '127.0.0.1'
            : AUDIENCE,
    } as never);
    const token = await sign();
    await expect(
      guardWithExpected.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).resolves.toBe(true);
  });

  it('rejects a malformed JWT with only one segment', async () => {
    await expect(
      guard().canActivate(makeCtx({ authorization: 'Bearer abc' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a malformed JWT with two segments', async () => {
    await expect(
      guard().canActivate(makeCtx({ authorization: 'Bearer abc.def' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a malformed JWT with four segments', async () => {
    await expect(
      guard().canActivate(makeCtx({ authorization: 'Bearer abc.def.ghi.jkl' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a JWT with empty segments', async () => {
    await expect(
      guard().canActivate(makeCtx({ authorization: 'Bearer ..' })),
    ).rejects.toMatchObject({ status: 401 });
  });
});
