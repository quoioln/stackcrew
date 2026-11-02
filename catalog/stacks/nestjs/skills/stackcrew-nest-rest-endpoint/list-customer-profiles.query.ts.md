Goes to `src/modules/customer-profiles/dto/list-customer-profiles.query.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/list-customer-profiles.query.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CustomerProfileStatus } from '../entities/customer-profile.entity';

export const MAX_PAGE_SIZE = 100;
/** Offset paging stops here: deeper pages cost a scan of every skipped row. Page further with a keyset cursor instead. */
export const MAX_PAGE = 1_000;
export const DEFAULT_PAGE_SIZE = 20;

/** A size over the maximum is not an error: it is capped, and the capped value is what the response reports. */
const capSize = ({ value }: { value: unknown }): unknown => (typeof value === 'number' ? Math.min(value, MAX_PAGE_SIZE) : value);

/** Sort keys a client may ask for: an allowlist, never a column name taken from the request. */
export const CustomerProfileSort = { CREATED_AT: 'createdAt', REFERENCE: 'reference' } as const;
export type CustomerProfileSort = (typeof CustomerProfileSort)[keyof typeof CustomerProfileSort];

export const SortDirection = { ASC: 'asc', DESC: 'desc' } as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

/**
 * GET /v1/customer-profiles?page=0&size=20&status=PENDING&sort=createdAt&direction=desc. Query values arrive as
 * strings and the global ValidationPipe has no implicit conversion: @Type(() => Number) turns page and size into
 * numbers before @IsInt runs. A missing value keeps its default. `page` is 0-based and valid below MAX_PAGE; `size`
 * below 1 fails validation and above MAX_PAGE_SIZE is capped (same bounds in every stack).
 */
export class ListCustomerProfilesQuery {
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_PAGE - 1, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PAGE - 1)
  readonly page: number = 0;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE, description: 'Capped at the maximum.' })
  @Type(() => Number)
  @Transform(capSize)
  @IsInt()
  @Min(1)
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
