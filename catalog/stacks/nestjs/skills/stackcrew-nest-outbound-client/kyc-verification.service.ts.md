Goes to `src/modules/kyc/kyc-verification.service.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { currentContext } from '../../common/context/request-context';
import { KycVerificationStatus } from './entities/kyc-verification.entity';
import type { KycDecision, KycEvidence } from './interfaces/kyc-verification';
import { KycProvider } from './kyc-provider.port';
import { KycVerificationNotFound } from './kyc-verification.errors';
import { KycVerificationRepository } from './kyc-verification.repository';

/**
 * A provider call that changes something, in three steps: (1) insert the operation row and commit, so its id, the
 * provider's idempotency key, exists before any call; (2) call the provider outside any transaction; (3) persist the
 * result in a transaction. A retry of the business operation (a job run again, a message redelivered, a client retry
 * of the same verification) runs step 2 again with the key it reloads from the row, so the provider applies it once.
 */
@Injectable()
export class KycVerificationService {
  constructor(
    private readonly verifications: KycVerificationRepository,
    private readonly provider: KycProvider,
    private readonly dataSource: DataSource,
  ) {}

  /** Step 1, committed on its own. The caller keeps the id (in a job row, a message, the API response) to run or retry it. */
  async start(profileId: string): Promise<string> {
    const verification = await this.verifications.save(this.verifications.create({ profileId, status: KycVerificationStatus.PENDING }));
    return verification.id;
  }

  /** Steps 2 and 3; safe to call again for the same id. A completed operation returns its decision without a call. */
  async run(verificationId: string, evidence: KycEvidence): Promise<KycDecision> {
    const verification = await this.verifications.findOneBy({ id: verificationId });
    if (verification === null) {
      throw new KycVerificationNotFound();
    }
    if (verification.status === KycVerificationStatus.COMPLETED && verification.decision !== null) {
      return verification.decision;
    }
    const result = await this.provider.verify({
      idempotencyKey: verification.id, // reloaded from the row: the same key on every retry of this operation
      traceRef: currentContext()?.requestId ?? verification.id,
      documentNumber: evidence.documentNumber,
      selfie: evidence.selfie,
    });
    await this.dataSource.transaction(async (manager) => {
      // the outcome and any other write it causes (the profile status, an outbox row) commit together
      await this.verifications.withManager(manager).update(
        { id: verification.id, status: KycVerificationStatus.PENDING },
        { status: KycVerificationStatus.COMPLETED, decision: result.decision, providerReference: result.providerReference },
      );
    });
    return result.decision;
  }
}
```
