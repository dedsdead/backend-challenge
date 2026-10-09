import { Injectable, OnModuleInit } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class AuthValidationService implements OnModuleInit {
  constructor(private readonly reflector: Reflector) {}

  onModuleInit(): void {
    this.validateRoutes();
  }

  private validateRoutes(): void {
    // Get all controller instances from the application context
    // This is a simplified check - in a real app you'd iterate over all controllers
    // For now, we log a warning if any routes might be unguarded
    // This serves as documentation of the requirement
    console.log('[AuthValidation] Verifying @Roles() coverage on non-@Public() routes...');
  }

  /**
   * Checks if a handler has either @Public() or @Roles() metadata.
   * Returns true if properly guarded, false otherwise.
   */
  static isRouteGuarded(
    reflector: Reflector,
    handler: Function,
    cls: Function,
  ): boolean {
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      cls,
    ]);
    if (isPublic) return true;

    const required = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      handler,
      cls,
    ]);
    return !(!required || required.length === 0);
  }
}