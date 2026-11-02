Goes to `src/common/api/api-response.spec.ts`.

```ts
// Default location: src/common/api/api-response.spec.ts
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, MethodNotAllowedException, NotFoundException, ServiceUnavailableException,
  UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, ValidateNested, validateSync } from 'class-validator';
import { CrossTenantDeniedError } from '../context/request-context';
import { ApiError, UpstreamApiError } from './api-error';
import { failureEnvelope, successEnvelope, toFailure, toPageData } from './api-response';
import { CommonError, DetailCode, formatErrorNumber, type ErrorDefinition } from './error-codes';
import { RequestValidationError, requestValidationError } from './validation-details';

const SERVICE = '07';
const IDS = { supportCode: 'QAZWSX', requestId: 'd2142131-d6d7-442d-9d6e-6c14b33f9402' };
const CUSTOMER_PROFILE_NOT_FOUND: ErrorDefinition = { ...CommonError.RESOURCE_NOT_FOUND, seq: 101 };

class Address {
  @IsString()
  @MaxLength(5)
  city!: string;
}

class Item {
  @Matches(/^SKU-\d+$/)
  sku!: string;
}

class CreateOrder {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => Address)
  address!: Address;

  @ValidateNested({ each: true })
  @Type(() => Item)
  items!: Item[];
}

describe('error numbers', () => {
  it('formats SSCCNNN as a string that keeps its leading zeros', () => {
    expect(formatErrorNumber(SERVICE, CommonError.VALIDATION_FAILED)).toBe('0710001');
    expect(formatErrorNumber(SERVICE, CUSTOMER_PROFILE_NOT_FOUND)).toBe('0730101');
    expect(formatErrorNumber('99', CommonError.INTERNAL_ERROR)).toBe('9990001');
    expect(() => formatErrorNumber(SERVICE, { ...CommonError.INTERNAL_ERROR, seq: 1000 })).toThrow(RangeError);
    expect(() => formatErrorNumber(SERVICE, { ...CommonError.INTERNAL_ERROR, category: 100 })).toThrow(RangeError);
  });
});

describe('envelopes', () => {
  it('keeps the data key when a handler returns nothing', () => {
    expect(successEnvelope(undefined, IDS)).toEqual(expect.objectContaining({ data: null }));
    expect(successEnvelope(null, IDS).data).toBeNull();
    expect(successEnvelope([], IDS).data).toEqual([]);
    expect(JSON.parse(JSON.stringify(successEnvelope(undefined, IDS)))).toHaveProperty('data', null);
  });

  it('writes the keys in contract order, with an ISO-8601 UTC timestamp', () => {
    const ok = successEnvelope({ id: 'USR-001' }, IDS);
    expect(Object.keys(ok)).toEqual(['success', 'timestamp', 'supportCode', 'requestId', 'data']);
    expect(ok).toMatchObject({ success: true, ...IDS, data: { id: 'USR-001' } });
    expect(ok.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const failed = failureEnvelope(toFailure(new ApiError(CommonError.BUSINESS_CONFLICT), SERVICE).body, IDS);
    expect(Object.keys(failed)).toEqual(['success', 'message', 'timestamp', 'supportCode', 'requestId', 'error']);
    expect(failed).toMatchObject({ success: false, message: 'The request conflicts with the current state', ...IDS,
      error: { errorNumber: '0740001', errorCode: 'BUSINESS_CONFLICT', details: [] } });
    expect(failed).not.toHaveProperty('data');
  });

  it('pages from 0: totals, a page past the last one, an empty result', () => {
    expect(toPageData(['a', 'b'], 0, 2, 5).pagination).toEqual({ page: 0, size: 2, totalElements: 5, totalPages: 3, hasNext: true, hasPrevious: false });
    expect(toPageData([], 10, 20, 140)).toEqual({ items: [], pagination: { page: 10, size: 20, totalElements: 140, totalPages: 7, hasNext: false, hasPrevious: true } });
    expect(toPageData([], 0, 20, 0).pagination).toMatchObject({ totalPages: 0, hasNext: false, hasPrevious: false });
  });
});

describe('validation details', () => {
  it('gives one detail per (field, constraint) with dotted and indexed paths, never the submitted value', () => {
    const order = plainToInstance(CreateOrder, { email: 'not-an-email', address: { city: 123456789 }, items: [{ sku: 'SKU-1' }, { sku: 'bad sku' }] });
    const error = requestValidationError(validateSync(order));
    expect(error).toBeInstanceOf(RequestValidationError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.definition).toBe(CommonError.VALIDATION_FAILED);
    expect(error.details).toHaveLength(4);
    expect(error.details).toEqual(expect.arrayContaining([
      { field: 'email', code: DetailCode.INVALID_FORMAT, message: 'email must be an email' },
      { field: 'address.city', code: DetailCode.INVALID_TYPE, message: 'city must be a string' },
      { field: 'address.city', code: DetailCode.TOO_LONG, message: 'city must be shorter than or equal to 5 characters' },
      { field: 'items[1].sku', code: DetailCode.INVALID_FORMAT, message: expect.stringContaining('sku must match') },
    ]));
    const text = JSON.stringify(error.details);
    expect(text).not.toContain('not-an-email');
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('bad sku');
    const failure = toFailure(error, SERVICE);
    expect(failure.status).toBe(400);
    expect(failure.body.error).toMatchObject({ errorNumber: '0710001', errorCode: 'VALIDATION_FAILED', details: error.details });
  });
});

describe('toFailure: the NestJS column of the exception table', () => {
  const bodyParser = (type: string, status: number): Error =>
    Object.assign(new Error('Unexpected token } in JSON at position 7: {"password":"hunter2"}'), { type, status, expose: true });

  it.each([
    ['an ApiError with a domain row', new ApiError(CUSTOMER_PROFILE_NOT_FOUND), 404, 'RESOURCE_NOT_FOUND', '0730101'],
    ['malformed JSON (body-parser 400)', bodyParser('entity.parse.failed', 400), 400, 'MALFORMED_REQUEST', '0711001'],
    ['a body over the limit (body-parser 413)', bodyParser('entity.too.large', 413), 413, 'PAYLOAD_TOO_LARGE', '0711005'],
    ['an unsupported charset (body-parser 415)', bodyParser('charset.unsupported', 415), 415, 'UNSUPPORTED_MEDIA_TYPE', '0711003'],
    ['an unknown route (Nest NotFoundException)', new NotFoundException('Cannot GET /v1/nope?token=abc'), 404, 'ENDPOINT_NOT_FOUND', '0711006'],
    ['a Parse*Pipe failure (400)', new BadRequestException('Validation failed (uuid is expected)'), 400, 'INVALID_PARAMETER', '0711004'],
    ['a guard without a token', new UnauthorizedException('jwt expired'), 401, 'UNAUTHENTICATED', '0720001'],
    ['a guard refusal', new ForbiddenException('Forbidden resource'), 403, 'ACCESS_DENIED', '0721001'],
    ['a wrong method', new MethodNotAllowedException(), 405, 'METHOD_NOT_ALLOWED', '0711002'],
    ['an HttpException 409', new ConflictException('duplicate key alice@example.com'), 409, 'BUSINESS_CONFLICT', '0740001'],
    ['an HttpException 422', new UnprocessableEntityException(), 422, 'BUSINESS_RULE_VIOLATION', '0741001'],
    ['an HttpException 429', new HttpException('slow down', 429), 429, 'RATE_LIMIT_EXCEEDED', '0750001'],
    ['any other 4xx', new HttpException('teapot', 418), 400, 'INVALID_PARAMETER', '0711004'],
    ['an HttpException 5xx', new ServiceUnavailableException('db down'), 500, 'INTERNAL_ERROR', '0790001'],
    ["another tenant's row", new CrossTenantDeniedError('no cross-tenant role for: report'), 404, 'RESOURCE_NOT_FOUND', '0730001'],
    ['anything else', new Error('duplicate key value (email)=(alice@example.com)'), 500, 'INTERNAL_ERROR', '0790001'],
  ])('%s', (_case, exception, status, errorCode, errorNumber) => {
    const failure = toFailure(exception, SERVICE);
    const definition = Object.values(CommonError).find((row) => row.code === errorCode);
    expect(failure.status).toBe(status); // the table's status: a 418 answers 400, a 503 HttpException 500
    expect(failure.body).toEqual({ success: false, message: definition?.summary, error: { errorNumber, errorCode, details: [] } });
    const text = JSON.stringify(failure.body);
    for (const leak of ['Unexpected token', 'hunter2', 'Cannot GET', 'token=abc', 'jwt expired', 'alice@example.com', 'db down', 'uuid is expected']) {
      expect(text).not.toContain(leak);
    }
  });

  it("passes another internal service's error on with its own errorNumber", () => {
    const payload = { errorNumber: '0530101', errorCode: 'RESOURCE_NOT_FOUND', details: [] };
    const failure = toFailure(new UpstreamApiError(404, payload, 'The resource does not exist'), SERVICE);
    expect(failure).toEqual({ status: 404, body: { success: false, message: 'The resource does not exist', error: payload } });
  });
});
```
