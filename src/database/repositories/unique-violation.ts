import { UniqueConstraintViolationException } from '@mikro-orm/core';

/**
 * Detects PostgreSQL unique-constraint violations (SQLSTATE 23505), whether the
 * error was converted by MikroORM or is still a raw driver error. Used by the
 * inbox flow to distinguish duplicate deliveries from real failures.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) {
    return true;
  }
  if (error instanceof Error) {
    const code =
      (error as { sqlState?: string }).sqlState ?? (error as { code?: string | number }).code;
    if (code === '23505' || code === 23505) {
      return true;
    }
    return /duplicate key value violates/i.test(error.message);
  }
  return false;
}
