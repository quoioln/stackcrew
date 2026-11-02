Goes to `src/common/api/validation-details.ts`.

```ts
// Default location: src/common/api/validation-details.ts
import type { ValidationError } from '@nestjs/common';
import { ApiError } from './api-error';
import type { ErrorDetail } from './api-response';
import { CommonError, DetailCode } from './error-codes';

/**
 * The class-validator column of the shared validator table: constraint name to details[].code, the same codes as Bean
 * Validation and zod. Anything not listed is INVALID_VALUE. @IsISO8601 reports 'isIso8601' and @IsUUID 'isUuid'.
 */
const CONSTRAINT_CODES: ReadonlyMap<string, DetailCode> = new Map<string, DetailCode>([
  ['isDefined', DetailCode.REQUIRED],
  ['isNotEmpty', DetailCode.REQUIRED],
  ['isEmail', DetailCode.INVALID_FORMAT],
  ['matches', DetailCode.INVALID_FORMAT],
  ['isUuid', DetailCode.INVALID_FORMAT],
  ['isUUID', DetailCode.INVALID_FORMAT],
  ['isUrl', DetailCode.INVALID_FORMAT],
  ['isISO8601', DetailCode.INVALID_FORMAT],
  ['isIso8601', DetailCode.INVALID_FORMAT],
  ['isDateString', DetailCode.INVALID_FORMAT],
  ['isString', DetailCode.INVALID_TYPE],
  ['isInt', DetailCode.INVALID_TYPE],
  ['isNumber', DetailCode.INVALID_TYPE],
  ['isBoolean', DetailCode.INVALID_TYPE],
  ['isArray', DetailCode.INVALID_TYPE],
  ['isObject', DetailCode.INVALID_TYPE],
  ['minLength', DetailCode.TOO_SHORT],
  ['arrayMinSize', DetailCode.TOO_SHORT],
  ['maxLength', DetailCode.TOO_LONG],
  ['arrayMaxSize', DetailCode.TOO_LONG],
  ['min', DetailCode.OUT_OF_RANGE],
  ['max', DetailCode.OUT_OF_RANGE],
  ['isPositive', DetailCode.OUT_OF_RANGE],
  ['isNegative', DetailCode.OUT_OF_RANGE],
  ['isEnum', DetailCode.INVALID_VALUE],
  ['isIn', DetailCode.INVALID_VALUE],
  ['whitelistValidation', DetailCode.INVALID_VALUE],
]);

/** class-validator names an array element by its index ('1'); the path shows it as items[1]. */
const ARRAY_INDEX = /^\d+$/;

/** Thrown by the global ValidationPipe (exceptionFactory below): VALIDATION_FAILED with one detail per (field, constraint). */
export class RequestValidationError extends ApiError {
  constructor(details: readonly ErrorDetail[]) {
    super(CommonError.VALIDATION_FAILED, details);
  }
}

/** ValidationPipe({ ..., exceptionFactory: requestValidationError }), also for query DTOs (P3-R11: query validation is VALIDATION_FAILED). */
export function requestValidationError(errors: ValidationError[]): RequestValidationError {
  return new RequestValidationError(validationDetails(errors));
}

/**
 * One detail per failed constraint, depth first: address.city for a nested object, items[1].sku for an array element.
 * The message is class-validator's rule text ("city must be a string"); never put $value in a validation message.
 */
export function validationDetails(errors: readonly ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = pathOf(parent, error.property);
    const own = Object.entries(error.constraints ?? {}).map(([constraint, rule]): ErrorDetail => ({
      field,
      code: CONSTRAINT_CODES.get(constraint) ?? DetailCode.INVALID_VALUE,
      message: rule,
    }));
    return [...own, ...validationDetails(error.children ?? [], field)];
  });
}

function pathOf(parent: string, property: string): string {
  if (ARRAY_INDEX.test(property)) {
    return `${parent}[${property}]`;
  }
  return parent === '' ? property : `${parent}.${property}`;
}
```
