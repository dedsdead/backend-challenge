import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Declares the realm roles required to reach a handler. Checked by the global
 * RolesGuard (plan T044); routes without this metadata are denied (fail-closed)
 * unless marked @Public().
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
