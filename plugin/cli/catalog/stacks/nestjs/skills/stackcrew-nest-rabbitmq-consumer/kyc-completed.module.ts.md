Goes to `src/modules/customer-profiles/messaging/kyc-completed.module.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-completed.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagingModule } from '../../../common/messaging/messaging.module';
import { CustomerProfileRepository } from '../customer-profile.repository';
import { CustomerProfile } from '../entities/customer-profile.entity';
import { KycCompletedConsumer } from './kyc-completed.consumer';
import { KycCompletedHandler } from './kyc-completed.handler';

/**
 * The kyc.completed consumer of the customer-profiles feature. AppModule imports it next to CustomerProfilesModule.
 * It provides its own CustomerProfileRepository (a stateless wrapper over the TypeORM repository), so the feature
 * module keeps exporting only its service.
 */
@Module({
  imports: [MessagingModule, TypeOrmModule.forFeature([CustomerProfile])],
  providers: [CustomerProfileRepository, KycCompletedHandler, KycCompletedConsumer],
})
export class KycCompletedModule {}
```
