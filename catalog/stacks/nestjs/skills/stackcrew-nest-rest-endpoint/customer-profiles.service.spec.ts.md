Goes to `src/modules/customer-profiles/customer-profiles.service.spec.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profiles.service.spec.ts
import { Test } from '@nestjs/testing';
import { CustomerProfileNotFound } from './customer-profile.errors';
import { CustomerProfileRepository } from './customer-profile.repository';
import { CustomerProfilesService } from './customer-profiles.service';
import { ListCustomerProfilesQuery } from './dto/list-customer-profiles.query';
import { CustomerProfile, CustomerProfileStatus } from './entities/customer-profile.entity';

type RepositoryFake = jest.Mocked<Pick<CustomerProfileRepository, 'findOneBy' | 'find' | 'count' | 'create' | 'save'>>;

const ID = '6f1c1c55-0c55-4b8f-9d55-5f0a3c7f1a01';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const RESPONSE_KEYS = ['createdAt', 'fullName', 'id', 'reference', 'status'];

/** An entity as the repository returns it, including the fields a response must leave out. */
const entity = (overrides: Partial<CustomerProfile> = {}): CustomerProfile => Object.assign(new CustomerProfile(), {
  id: ID, reference: 'ref-1', fullName: 'Nguyen Van A', status: CustomerProfileStatus.PENDING, {{sc:tenantColumn}}: 'tenant-a',
  createdAt: CREATED_AT, createdBy: 'alice', updatedAt: CREATED_AT, updatedBy: 'alice', deletedAt: null, ...overrides,
});
const query = (values: Partial<ListCustomerProfilesQuery> = {}): ListCustomerProfilesQuery => Object.assign(new ListCustomerProfilesQuery(), values);

describe('CustomerProfilesService', () => {
  let repository: RepositoryFake;
  let service: CustomerProfilesService;

  beforeEach(async () => {
    repository = { findOneBy: jest.fn(), find: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [CustomerProfilesService, { provide: CustomerProfileRepository, useValue: repository }],
    }).compile();
    service = moduleRef.get(CustomerProfilesService);
  });

  it('returns the response DTO of a profile, without the tenant or audit fields', async () => {
    repository.findOneBy.mockResolvedValue(entity());
    const result = await service.get(ID);
    expect(Object.keys(result).sort()).toEqual(RESPONSE_KEYS);
    expect(result).toMatchObject({ id: ID, reference: 'ref-1', status: CustomerProfileStatus.PENDING, createdAt: CREATED_AT });
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: ID });
  });

  it('throws CustomerProfileNotFound when the repository finds nothing (no row, or another tenant)', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.get(ID)).rejects.toBeInstanceOf(CustomerProfileNotFound);
  });

  it('pages with skip and take, a stable order and the same filter for the count', async () => {
    repository.find.mockResolvedValue([entity()]);
    repository.count.mockResolvedValue(11);
    const page = await service.list(query({ page: 2, size: 10, status: CustomerProfileStatus.PENDING }));
    const where = { status: CustomerProfileStatus.PENDING };
    expect(repository.find).toHaveBeenCalledWith({ where, order: { createdAt: 'desc', id: 'desc' }, skip: 10, take: 10 });
    expect(repository.count).toHaveBeenCalledWith({ where });
    expect(page).toMatchObject({ page: 2, size: 10, total: 11 });
    expect(page.items.map((item) => Object.keys(item).sort())).toEqual([RESPONSE_KEYS]);
  });

  it('sorts only by an allowlisted key', async () => {
    repository.find.mockResolvedValue([]);
    repository.count.mockResolvedValue(0);
    await service.list(query({ sort: 'reference', direction: 'asc' }));
    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: {}, order: { reference: 'asc', id: 'asc' }, skip: 0, take: 20 }));
  });

  it('creates a pending profile from the request fields only', async () => {
    repository.create.mockImplementation((data) => Object.assign(new CustomerProfile(), data));
    repository.save.mockImplementation(async (draft) => Object.assign(draft, { id: ID, createdAt: CREATED_AT, {{sc:tenantColumn}}: 'tenant-a' }));
    const created = await service.create({ reference: 'ref-1', fullName: 'Nguyen Van A' });
    expect(repository.create).toHaveBeenCalledWith({ reference: 'ref-1', fullName: 'Nguyen Van A', status: CustomerProfileStatus.PENDING });
    expect(Object.keys(created).sort()).toEqual(RESPONSE_KEYS);
  });
});
```
