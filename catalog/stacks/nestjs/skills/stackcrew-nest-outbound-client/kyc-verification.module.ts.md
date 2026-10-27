Goes to `src/modules/kyc/kyc-verification.module.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerification } from './entities/kyc-verification.entity';
import type { KycOutcomeEffects } from './interfaces/kyc-verification';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KycVerificationService } from './kyc-verification.service';
import { KYC_OUTCOME_EFFECTS } from './kyc.constants';
import { KycModule } from './kyc.module';

/** The default outcome side writes: none. The service then writes the status only. */
const NO_OUTCOME_EFFECTS: KycOutcomeEffects = {
  completed: () => Promise.resolve(),
  failed: () => Promise.resolve(),
};

/** The verification operations on top of the provider client; callers inject KycVerificationService. */
@Module({
  imports: [KycModule, TypeOrmModule.forFeature([KycVerification])],
  providers: [
    KycVerificationRepository,
    KycVerificationService,
    // The feature that owns the side writes replaces this line, here with
    //   { provide: KYC_OUTCOME_EFFECTS, useClass: ProfileKycOutcomeEffects },
    // or deletes it and imports a module that provides and exports KYC_OUTCOME_EFFECTS. Never both: a binding in
    // this module wins over an imported one, so the imported effects would never run.
    { provide: KYC_OUTCOME_EFFECTS, useValue: NO_OUTCOME_EFFECTS },
  ],
  exports: [KycVerificationService],
})
export class KycVerificationModule {}
```
