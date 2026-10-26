Goes to `src/modules/kyc/kyc-verification.module.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KycVerificationService } from './kyc-verification.service';
import { KycModule } from './kyc.module';

/** The verification operations on top of the provider client; callers inject KycVerificationService. */
@Module({
  imports: [KycModule, TypeOrmModule.forFeature([KycVerification])],
  providers: [KycVerificationRepository, KycVerificationService],
  exports: [KycVerificationService],
})
export class KycVerificationModule {}
```
