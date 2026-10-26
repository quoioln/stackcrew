Goes to `src/modules/customer-profiles/dto/create-customer-profile.request.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/create-customer-profile.request.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { FULL_NAME_LENGTH, REFERENCE_LENGTH } from '../entities/customer-profile.entity';

/**
 * What a client may send to create a profile, and nothing else: the global ValidationPipe (whitelist and
 * forbidNonWhitelisted) rejects any other field. The service decides the profile's state; the subscribers fill the
 * tenant and the audit columns. A request DTO is never an entity and never reused as a response.
 */
export class CreateCustomerProfileRequest {
  @ApiProperty({ maxLength: REFERENCE_LENGTH })
  @IsString()
  @Length(1, REFERENCE_LENGTH)
  readonly reference!: string;

  @ApiProperty({ maxLength: FULL_NAME_LENGTH })
  @IsString()
  @Length(1, FULL_NAME_LENGTH)
  readonly fullName!: string;
}
```
