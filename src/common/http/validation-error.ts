import { BadRequestException } from '@nestjs/common';
import type { ValidationError as ClassValidatorError } from 'class-validator';

/** Flatten class-validator errors into dotted paths with non-empty constraints (AC-24/G9). */
function flattenValidationErrors(
  errors: ClassValidatorError[],
  prefix = '',
): { property: string; constraints: Record<string, string> }[] {
  const flat: { property: string; constraints: Record<string, string> }[] = [];
  for (const error of errors) {
    const property = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints && Object.keys(error.constraints).length > 0) {
      flat.push({ property, constraints: error.constraints });
    }
    if (error.children && error.children.length > 0) {
      flat.push(...flattenValidationErrors(error.children, property));
    }
  }
  return flat;
}

/** Pinned AC-24/G9 400 body shape: { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', errors: [{ property, constraints }] } */
export function validationError(errors: import('class-validator').ValidationError[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    errors: flattenValidationErrors(errors),
  });
}