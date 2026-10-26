Goes to `src/modules/customer-profiles/dto/list-customer-profiles.query.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/list-customer-profiles.query.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CustomerProfileStatus } from '../entities/customer-profile.entity';

export const MAX_PAGE_SIZE = 100;
/** Offset paging stops here: deeper pages cost a scan of every skipped row. Page further with a keyset cursor instead. */
export const MAX_PAGE = 1_000;
const DEFAULT_PAGE_SIZE = 20;

/** Sort keys a client may ask for: an allowlist, never a column name taken from the request. */
export const CustomerProfileSort = { CREATED_AT: 'createdAt', REFERENCE: 'reference' } as const;
export type CustomerProfileSort = (typeof CustomerProfileSort)[keyof typeof CustomerProfileSort];

export const SortDirection = { ASC: 'asc', DESC: 'desc' } as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

/**
 * GET /v1/customer-profiles?page=1&size=20&status=PENDING&sort=createdAt&direction=desc. Query values arrive as
 * strings and the global ValidationPipe has no implicit conversion: @Type(() => Number) turns page and size into
 * numbers before @IsInt runs. A missing value keeps its default.
 */
export class ListCustomerProfilesQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  readonly page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly size: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ enum: Object.values(CustomerProfileStatus) })
  @IsOptional()
  @IsIn(Object.values(CustomerProfileStatus))
  readonly status?: CustomerProfileStatus;

  @ApiPropertyOptional({ enum: Object.values(CustomerProfileSort), default: CustomerProfileSort.CREATED_AT })
  @IsIn(Object.values(CustomerProfileSort))
  readonly sort: CustomerProfileSort = CustomerProfileSort.CREATED_AT;

  @ApiPropertyOptional({ enum: Object.values(SortDirection), default: SortDirection.DESC })
  @IsIn(Object.values(SortDirection))
  readonly direction: SortDirection = SortDirection.DESC;
}
```
