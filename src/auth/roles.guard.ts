import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

interface AuthedUser {
  realm_access?: { roles?: unknown };
}

/**
 * Global authorization guard (plan T044). Reads realm roles from the verified
 * token (set on the request by JwtGuard) and requires at least one of the
 * handler's @Roles(). Fails closed: no @Roles metadata or a token without
 * usable realm roles yields 403 ROLE_FORBIDDEN.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, cls]))
      return true;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      handler,
      cls,
    ]);
    if (!required || required.length === 0) throw new ForbiddenException();

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthedUser | undefined;
    const raw = user?.realm_access?.roles;
    const roles = Array.isArray(raw) ? raw : [];

    if (!required.some((role) => roles.includes(role)))
      throw new ForbiddenException();
    return true;
  }
}
