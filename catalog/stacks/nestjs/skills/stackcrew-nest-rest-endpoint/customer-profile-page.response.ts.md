Goes to `src/modules/customer-profiles/dto/customer-profile-page.response.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/customer-profile-page.response.ts
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { CustomerProfileResponse } from './customer-profile.response';

/** One page of profiles: the items, the page asked for and the total, so a client can page. Never an unbounded list. */
export class CustomerProfilePageResponse {
  @Expose()
  @ApiProperty({ type: [CustomerProfileResponse] })
  @Type(() => CustomerProfileResponse)
  readonly items!: readonly CustomerProfileResponse[];

  @Expose()
  @ApiProperty({ minimum: 1 })
  readonly page!: number;

  @Expose()
  @ApiProperty({ minimum: 1 })
  readonly size!: number;

  @Expose()
  @ApiProperty({ minimum: 0 })
  readonly total!: number;
}
```
