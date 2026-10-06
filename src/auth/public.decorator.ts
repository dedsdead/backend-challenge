import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a handler or controller as publicly accessible (no auth guard).
 * Consumed by the global JWT guard in Phase 8 (plan T044); safe to use
 * before the guard exists.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
