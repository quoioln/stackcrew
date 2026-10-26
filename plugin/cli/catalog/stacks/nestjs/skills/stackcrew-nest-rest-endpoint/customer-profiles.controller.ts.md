Goes to `src/modules/customer-profiles/customer-profiles.controller.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profiles.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CustomerProfilesService } from './customer-profiles.service';
// value imports, not `import type`: the ValidationPipe reads these classes from the decorator metadata
import { CreateCustomerProfileRequest } from './dto/create-customer-profile.request';
import { CustomerProfilePageResponse } from './dto/customer-profile-page.response';
import { CustomerProfileResponse } from './dto/customer-profile.response';
import { ListCustomerProfilesQuery } from './dto/list-customer-profiles.query';

const CUSTOMER_PROFILES_PATH = 'v1/customer-profiles';
const CUSTOMER_PROFILES_TAG = 'customer-profiles';
const ID = 'id';

/**
 * Thin: each handler maps HTTP to one service call and returns its response DTO. The tenant comes from the token
 * (request context), never from a parameter; errors become RFC 7807 responses in AllExceptionsFilter.
 */
@ApiTags(CUSTOMER_PROFILES_TAG)
@Controller(CUSTOMER_PROFILES_PATH)
export class CustomerProfilesController {
  constructor(private readonly service: CustomerProfilesService) {}

  @Get()
  @ApiOkResponse({ type: CustomerProfilePageResponse })
  list(@Query() query: ListCustomerProfilesQuery): Promise<CustomerProfilePageResponse> {
    return this.service.list(query);
  }

  @Get(`:${ID}`)
  @ApiOkResponse({ type: CustomerProfileResponse })
  get(@Param(ID, ParseUUIDPipe) id: string): Promise<CustomerProfileResponse> {
    return this.service.get(id);
  }

  @Post()
  @ApiCreatedResponse({ type: CustomerProfileResponse })
  create(@Body() request: CreateCustomerProfileRequest): Promise<CustomerProfileResponse> {
    return this.service.create(request);
  }
}
```
