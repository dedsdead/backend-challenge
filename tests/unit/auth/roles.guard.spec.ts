import { describe, expect, it } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../src/auth/roles.guard';
import { ROLES_KEY } from '../../../src/auth/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator';

class TestController {
  writeHandler(): void {}
  readHandler(): void {}
  bareHandler(): void {}
  publicHandler(): void {}
}

const makeCtx = (
  user: unknown,
  handler: (...args: unknown[]) => unknown,
) => {
  const request = { user } as never;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
};

const guard = (): RolesGuard => new RolesGuard(new Reflector());

const withRoles = (roles: string[], handler: () => void): void => {
  Reflect.defineMetadata(ROLES_KEY, roles, handler);
};

describe('RolesGuard (plan T044)', () => {
  it('lets @Public() routes through without role checks', () => {
    const handler = TestController.prototype.publicHandler;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    expect(guard().canActivate(makeCtx(undefined, handler))).toBe(true);
  });

  it('allows a token carrying the required realm role', () => {
    const handler = TestController.prototype.writeHandler;
    withRoles(['transact:write'], handler);
    const user = { realm_access: { roles: ['transact:write', 'transact:read'] } };
    expect(guard().canActivate(makeCtx(user, handler))).toBe(true);
  });

  it('rejects a token missing the required realm role (403 ROLE_FORBIDDEN)', () => {
    const handler = TestController.prototype.writeHandler;
    withRoles(['transact:write'], handler);
    const user = { realm_access: { roles: ['transact:read'] } };
    expect(() => guard().canActivate(makeCtx(user, handler))).toThrowError(
      expect.objectContaining({ status: 403 }) as unknown as Error,
    );
  });

  it('rejects a token with no realm roles at all (403)', () => {
    const handler = TestController.prototype.readHandler;
    withRoles(['transact:read'], handler);
    expect(() => guard().canActivate(makeCtx({}, handler))).toThrowError(
      expect.objectContaining({ status: 403 }) as unknown as Error,
    );
  });

  it('fails closed (403) on a non-public route without @Roles metadata', () => {
    const handler = TestController.prototype.bareHandler;
    const user = { realm_access: { roles: ['transact:write'] } };
    expect(() => guard().canActivate(makeCtx(user, handler))).toThrowError(
      expect.objectContaining({ status: 403 }) as unknown as Error,
    );
  });
});
