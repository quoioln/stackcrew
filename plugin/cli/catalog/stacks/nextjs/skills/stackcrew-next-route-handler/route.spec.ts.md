Goes to `src/app/api/v1/kyc-registrations/route.spec.ts`.

```ts
// Default location: src/app/api/v1/kyc-registrations/route.spec.ts
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../../../auth';
import type { KycRegistration } from '../../../../features/kyc-registrations/kyc-registration.entity';
import { kycRegistrations, type KycRegistrationRepository } from '../../../../features/kyc-registrations/kyc-registration.repository';
import { logger } from '../../../../shared/logging/logger';
import { GET, POST } from './route';

// Boundaries only: the session, the headers, the cache and the repository. The handlers, withRouteLogging, the shared
// functions, the schemas, the problem details and the masker run for real.
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../../auth', () => ({ auth: vi.fn() }));
vi.mock('../../../../features/kyc-registrations/kyc-registration.repository', () => ({ kycRegistrations: vi.fn() }));

const ENDPOINT = 'http://localhost/api/v1/kyc-registrations';
const CONTEXT = { params: Promise.resolve({}) };
const INPUT = { fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'NATIONAL_ID', idNumber: '079090001234' };
const CREATED_AT = new Date('2026-10-27T03:00:00.000Z');
const authMock = auth as unknown as Mock<() => Promise<unknown>>;
const signIn = (id: string, roles: string[]): void => {
  authMock.mockResolvedValue({ user: { id, tenantId: 'tenant-a', roles }, expires: '2099-01-01T00:00:00.000Z' });
};
const post = (body: string, contentType = 'application/json'): NextRequest =>
  new NextRequest(ENDPOINT, { method: 'POST', body, headers: { 'content-type': contentType } });
const problemOf = async (response: Response): Promise<unknown> => {
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return response.json();
};

describe('/api/v1/kyc-registrations', () => {
  let repository: { [K in 'create' | 'insertUnlessRegistered' | 'find' | 'count']: Mock<KycRegistrationRepository[K]> };
  let lines: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    lines = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((line: unknown) => {
        if (typeof line === 'object' && line !== null && 'event' in line && line.event === 'http_in') {
          lines.push({ ...line });
        }
      });
    }
    vi.mocked(headers).mockResolvedValue(new Headers());
    repository = {
      create: vi.fn<KycRegistrationRepository['create']>((data) => data as KycRegistration),
      insertUnlessRegistered: vi.fn<KycRegistrationRepository['insertUnlessRegistered']>(async (r) => ({ ...r, id: 'reg-1', createdAt: CREATED_AT }) as KycRegistration),
      find: vi.fn<KycRegistrationRepository['find']>().mockResolvedValue([]),
      count: vi.fn<KycRegistrationRepository['count']>().mockResolvedValue(0),
    };
    vi.mocked(kycRegistrations).mockResolvedValue(repository as unknown as KycRegistrationRepository);
    signIn('alice', ['kyc_applicant']);
  });

  it('POST answers 201 with the DTO, takes the applicant and tenant from the session, and writes one masked http_in line', async () => {
    const response = await POST(post(JSON.stringify({ ...INPUT, tenantId: 'tenant-b', applicantId: 'mallory' })), CONTEXT);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'reg-1', documentType: 'NATIONAL_ID', status: 'PENDING', submittedAt: '2026-10-27T03:00:00.000Z' });
    expect(repository.create).toHaveBeenCalledWith({ ...INPUT, applicantId: 'alice', status: 'PENDING' });
    expect(revalidatePath).toHaveBeenCalledWith('/kyc/registrations');
    await vi.waitFor(() => expect(lines).toHaveLength(1)); // written once both body copies are read
    expect(lines[0]).toMatchObject({ method: 'POST', route: '/api/v1/kyc-registrations', status: 201, userId: 'alice', tenantId: 'tenant-a' });
    expect(lines[0]?.reqBody).toContain('"idNumber":"***"');
  });

  it('POST answers 401 without a session and 403 without the applicant role, as problems', async () => {
    authMock.mockResolvedValue(null);
    const anonymous = await POST(post(JSON.stringify(INPUT)), CONTEXT);
    expect(anonymous.status).toBe(401);
    expect(await problemOf(anonymous)).toEqual({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Sign in to use this resource.' });

    signIn('rita', ['kyc_reviewer']);
    const forbidden = await POST(post(JSON.stringify(INPUT)), CONTEXT);
    expect(await problemOf(forbidden)).toMatchObject({ status: 403, title: 'Forbidden' });
    expect(kycRegistrations).not.toHaveBeenCalled();
  });

  it('POST answers 415 for a body that is not JSON and 400 for malformed JSON, before any write', async () => {
    expect(await problemOf(await POST(post('fullName=A', 'application/x-www-form-urlencoded'), CONTEXT))).toMatchObject({ status: 415 });
    expect(await problemOf(await POST(post('{"fullName":'), CONTEXT))).toEqual({
      type: 'about:blank', title: 'Bad Request', status: 400, detail: 'The request body is not valid JSON.',
    });
    expect(repository.insertUnlessRegistered).not.toHaveBeenCalled();
  });

  it('POST answers 400 with the field errors of the schema, never quoting the input', async () => {
    const response = await POST(post(JSON.stringify({ ...INPUT, documentType: 'DRIVER', idNumber: 'x' })), CONTEXT);

    const problem = await problemOf(response);
    expect(problem).toMatchObject({ type: 'about:blank', status: 400, detail: 'The request is invalid.' });
    expect(problem).toHaveProperty('errors', [
      { field: 'documentType', messages: ['Choose a document type.'] },
      { field: 'idNumber', messages: ['Use 6 to 20 capital letters and digits.'] },
    ]);
    expect(JSON.stringify(problem)).not.toContain('DRIVER');
  });

  it('checks the caller before the input: 401 and 403 win over a malformed or non-JSON body and a bad query', async () => {
    authMock.mockResolvedValue(null);
    expect(await problemOf(await POST(post('{"fullName":'), CONTEXT))).toMatchObject({ status: 401 });
    expect(await problemOf(await GET(new NextRequest(`${ENDPOINT}?size=1000`), CONTEXT))).toMatchObject({ status: 401 });

    signIn('rita', ['kyc_reviewer']);
    expect(await problemOf(await POST(post('fullName=A', 'application/x-www-form-urlencoded'), CONTEXT))).toMatchObject({ status: 403 });
    signIn('alice', ['kyc_applicant']);
    expect(await problemOf(await GET(new NextRequest(`${ENDPOINT}?size=1000`), CONTEXT))).toMatchObject({ status: 403 });
    expect(kycRegistrations).not.toHaveBeenCalled();
  });

  it('POST answers 409 when the applicant already registered', async () => {
    repository.insertUnlessRegistered.mockResolvedValue(null);

    expect(await problemOf(await POST(post(JSON.stringify(INPUT)), CONTEXT))).toMatchObject({ status: 409, title: 'Conflict' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('GET answers 200 with a page for a reviewer, and 400 for a page size over the maximum', async () => {
    signIn('rita', ['kyc_reviewer']);
    repository.count.mockResolvedValue(3);

    const ok = await GET(new NextRequest(`${ENDPOINT}?page=2&size=2`), CONTEXT);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [], page: 2, size: 2, total: 3 });
    expect(repository.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC', id: 'DESC' }, take: 2, skip: 2 });
    await vi.waitFor(() => expect(lines).toContainEqual(expect.objectContaining({ method: 'GET', status: 200, userId: 'rita' })));

    const bad = await GET(new NextRequest(`${ENDPOINT}?size=1000`), CONTEXT);
    expect(bad.status).toBe(400);
    expect(await problemOf(bad)).toMatchObject({ errors: [{ field: 'size', messages: [expect.any(String)] }] });
  });

  it('GET answers 403 to an applicant', async () => {
    expect(await problemOf(await GET(new NextRequest(ENDPOINT), CONTEXT))).toMatchObject({ status: 403 });
  });
});
```
