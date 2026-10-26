Goes to `src/modules/customer-profiles/customer-profiles.service.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profiles.service.ts
import { Injectable } from '@nestjs/common';
import type { FindOptionsOrder, FindOptionsWhere } from 'typeorm';
import { CustomerProfileNotFound } from './customer-profile.errors';
import { toCustomerProfilePage, toCustomerProfileResponse } from './customer-profile.mapper';
import { CustomerProfileRepository } from './customer-profile.repository';
import type { CreateCustomerProfileRequest } from './dto/create-customer-profile.request';
import type { CustomerProfilePageResponse } from './dto/customer-profile-page.response';
import type { CustomerProfileResponse } from './dto/customer-profile.response';
import { CustomerProfileSort, type ListCustomerProfilesQuery } from './dto/list-customer-profiles.query';
import { CustomerProfileStatus, type CustomerProfile } from './entities/customer-profile.entity';

/**
 * The rules for customer profiles. Every read and write goes through CustomerProfileRepository, so each query carries
 * the caller's tenant; the methods return response DTOs, never an entity.
 */
@Injectable()
export class CustomerProfilesService {
  constructor(private readonly profiles: CustomerProfileRepository) {}

  async get(id: string): Promise<CustomerProfileResponse> {
    const profile = await this.profiles.findOneBy({ id });
    if (profile === null) {
      throw new CustomerProfileNotFound(); // also for an id of another tenant: the repository finds nothing
    }
    return toCustomerProfileResponse(profile);
  }

  async list(query: ListCustomerProfilesQuery): Promise<CustomerProfilePageResponse> {
    const where: FindOptionsWhere<CustomerProfile> = query.status === undefined ? {} : { status: query.status };
    const [rows, total] = await Promise.all([
      this.profiles.find({ where, order: sortOrder(query), skip: (query.page - 1) * query.size, take: query.size }),
      this.profiles.count({ where }),
    ]);
    return toCustomerProfilePage(rows, total, query);
  }

  async create(request: CreateCustomerProfileRequest): Promise<CustomerProfileResponse> {
    const draft = this.profiles.create({ reference: request.reference, fullName: request.fullName, status: CustomerProfileStatus.PENDING });
    return toCustomerProfileResponse(await this.profiles.save(draft));
  }
}

/** A stable order from the allowlisted sort key, with the id as tie-breaker so two pages never share a row. */
function sortOrder(query: ListCustomerProfilesQuery): FindOptionsOrder<CustomerProfile> {
  return query.sort === CustomerProfileSort.REFERENCE
    ? { reference: query.direction, id: query.direction }
    : { createdAt: query.direction, id: query.direction };
}
```
