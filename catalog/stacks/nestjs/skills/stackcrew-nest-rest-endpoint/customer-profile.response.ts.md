Goes to `src/modules/customer-profiles/dto/customer-profile.response.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/customer-profile.response.ts
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { CustomerProfileStatus } from '../entities/customer-profile.entity';

/**
 * The API shape of a customer profile. The mapper copies only the @Expose() fields (excludeExtraneousValues), so the
 * tenant, the audit fields and any column added to the entity later never reach a client.
 */
export class CustomerProfileResponse {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @Expose()
  @ApiProperty()
  readonly reference!: string;

  @Expose()
  @ApiProperty()
  readonly fullName!: string;

  @Expose()
  @ApiProperty({ enum: Object.values(CustomerProfileStatus) })
  readonly status!: CustomerProfileStatus;

  @Expose()
  @ApiProperty({ type: String, format: 'date-time' })
  readonly createdAt!: Date;
}
```
