Goes to `src/common/api/api-envelope-response.decorator.ts`.

```ts
// Default location: src/common/api/api-envelope-response.decorator.ts
import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse as ApiDocResponse, getSchemaPath } from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { DetailCode } from './error-codes';

/** The success statuses (no 204: a delete answers 200 with data null). */
type SuccessStatus = 200 | 201;

const SUPPORT_CODE_PATTERN = '^[A-Z]{6}$';
const ERROR_NUMBER_PATTERN = '^\\d{7}$';

const IDS: Record<string, SchemaObject> = {
  timestamp: { type: 'string', format: 'date-time' },
  supportCode: { type: 'string', pattern: SUPPORT_CODE_PATTERN },
  requestId: { type: 'string', format: 'uuid' },
};

const PAGINATION: SchemaObject = {
  type: 'object',
  required: ['page', 'size', 'totalElements', 'totalPages', 'hasNext', 'hasPrevious'],
  properties: {
    page: { type: 'integer', minimum: 0 },
    size: { type: 'integer', minimum: 1 },
    totalElements: { type: 'integer', minimum: 0 },
    totalPages: { type: 'integer', minimum: 0 },
    hasNext: { type: 'boolean' },
    hasPrevious: { type: 'boolean' },
  },
};

const FAILURE: SchemaObject = {
  type: 'object',
  required: ['success', 'message', 'timestamp', 'supportCode', 'requestId', 'error'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
    ...IDS,
    error: {
      type: 'object',
      required: ['errorNumber', 'errorCode', 'details'],
      properties: {
        errorNumber: { type: 'string', pattern: ERROR_NUMBER_PATTERN },
        errorCode: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field', 'code', 'message'],
            properties: { field: { type: 'string', nullable: true }, code: { type: 'string', enum: Object.values(DetailCode) }, message: { type: 'string' } },
          },
        },
      },
    },
  },
};

function success(data: SchemaObject | ReferenceObject): SchemaObject {
  return {
    type: 'object',
    required: ['success', 'timestamp', 'supportCode', 'requestId', 'data'],
    properties: { success: { type: 'boolean', enum: [true] }, ...IDS, data },
  };
}

/**
 * The OpenAPI document shows the envelope, never the bare DTO: `@ApiEnvelopeResponse(CustomerProfileResponse)`, with
 * `{ status: 201 }` on a create and `{ page: true }` for PageData of the model. Every operation that uses it also
 * documents the error envelope for 4XX and 5XX.
 */
export function ApiEnvelopeResponse(model: Type<unknown>, options: { status?: SuccessStatus; page?: boolean } = {}): MethodDecorator {
  const item: ReferenceObject = { $ref: getSchemaPath(model) };
  const data: SchemaObject | ReferenceObject = options.page === true
    ? { type: 'object', required: ['items', 'pagination'], properties: { items: { type: 'array', items: item }, pagination: PAGINATION } }
    : item;
  return applyDecorators(
    ApiExtraModels(model),
    ApiDocResponse({ status: options.status ?? HttpStatus.OK, schema: success(data) }),
    ApiDocResponse({ status: '4XX', schema: FAILURE }),
    ApiDocResponse({ status: '5XX', schema: FAILURE }),
  );
}
```
