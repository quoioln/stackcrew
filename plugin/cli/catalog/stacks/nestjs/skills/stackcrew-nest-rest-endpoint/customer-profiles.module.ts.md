Goes to `src/modules/customer-profiles/customer-profiles.module.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profiles.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerProfileRepository } from './customer-profile.repository';
import { CustomerProfilesController } from './customer-profiles.controller';
import { CustomerProfilesService } from './customer-profiles.service';
import { CustomerProfile } from './entities/customer-profile.entity';

/** One module per feature; other modules call the service, never the repository or the controller. */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerProfile])],
  controllers: [CustomerProfilesController],
  providers: [CustomerProfileRepository, CustomerProfilesService],
  exports: [CustomerProfilesService],
})
export class CustomerProfilesModule {}
```
