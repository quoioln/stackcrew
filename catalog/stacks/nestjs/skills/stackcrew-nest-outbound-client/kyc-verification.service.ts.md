Goes to `src/modules/kyc/kyc-verification.service.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { currentContext } from '../../common/context/request-context';
import { ProviderRejectedError } from '../../common/providers/provider.errors';
import { KycVerificationStatus } from './entities/kyc-verification.entity';
import type { KycDecision, KycEvidence, KycOutcomeEffects, VerifyIdentityResult } from './interfaces/kyc-verification';
import { KycProvider } from './kyc-provider.port';
import { KycVerificationFailed, KycVerificationNotFound } from './kyc-verification.errors';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KYC_OUTCOME_EFFECTS } from './kyc.constants';

/**
 * A provider call that changes something, in three steps: (1) insert the operation row and commit, so its id, the
 * provider's idempotency key, exists before any call; (2) call the provider outside any transaction; (3) persist the
 * result in a transaction. A retry of the business operation (a job run again, a message redelivered, a client retry
 * of the same verification) runs step 2 again with the key it reloads from the row, so the provider applies it once.
 * The evidence is PII and never stored on the row: the caller passes it on every run, loaded by its reference.
 *
 * Two runs of one operation can overlap (a redelivery during a slow call, the orphan sweep, two requests that got
 * the same pending operation). The row decides: every status write is guarded by the statuses it may replace and
 * reads its affected count inside its transaction; the side writes follow only when exactly one row changed, and a
 * write that changed no row reloads the row and answers with its stored state. A provider success is authoritative,
 * so COMPLETED replaces PENDING or FAILED, and nothing replaces COMPLETED. The side writes (KYC_OUTCOME_EFFECTS, always
 * bound: the module binds a no-op by default) run inside the status transaction, so one that throws rolls the status
 * write back and `run` rejects with its error.
 */
@Injectable()
export class KycVerificationService {
  constructor(
    private readonly verifications: KycVerificationRepository,
    private readonly provider: KycProvider,
    private readonly dataSource: DataSource,
    @Inject(KYC_OUTCOME_EFFECTS) private readonly effects: KycOutcomeEffects,
  ) {}

  /**
   * Step 1, committed on its own: the profile's PENDING operation, a new one or the one already pending, so a repeated
   * request gets the same operation and the same key. The caller keeps the id (in a job row, a message, the API
   * response) to run or retry it.
   */
  async start(profileId: string): Promise<string> {
    return this.verifications.startPending(profileId);
  }

  /**
   * Steps 2 and 3; safe to call again for the same id, also while another run of it is in flight. A completed
   * operation returns its decision without a call; a failed one throws KycVerificationFailed. A provider refusal
   * ends the operation FAILED; any other failure leaves it PENDING, so a retry calls again with the same key.
   */
  async run(verificationId: string, evidence: KycEvidence): Promise<KycDecision> {
    const verification = await this.verifications.findOneBy({ id: verificationId });
    if (verification === null) {
      throw new KycVerificationNotFound();
    }
    if (verification.status === KycVerificationStatus.COMPLETED && verification.decision !== null) {
      return verification.decision;
    }
    if (verification.status === KycVerificationStatus.FAILED) {
      throw new KycVerificationFailed();
    }
    let result: VerifyIdentityResult;
    try {
      result = await this.provider.verify({
        idempotencyKey: verification.id, // reloaded from the row: the same key on every retry of this operation
        traceRef: currentContext()?.requestId ?? verification.id,
        documentNumber: evidence.documentNumber,
        selfie: evidence.selfie,
      });
    } catch (failure: unknown) {
      if (failure instanceof ProviderRejectedError) {
        // the provider refused this request (400, 404, 422) and would refuse it again under the same key: the operation
        // ends here, unless another run of it already completed it (nothing replaces COMPLETED)
        const ended = await this.dataSource.transaction(async (manager) => {
          const rows = await this.verifications.withManager(manager).update({ id: verification.id, status: KycVerificationStatus.PENDING }, { status: KycVerificationStatus.FAILED });
          if (rows === 1) {
            await this.effects.failed(manager, verification); // the failure's side writes, only with the status write that won
          }
          return rows;
        });
        if (ended === 0) {
          const decision = await this.completedDecision(verification.id);
          if (decision !== undefined) {
            return decision;
          }
        }
      }
      throw failure; // unavailable (a 5xx, 429, 409, 401, 403, no reply), or an invalid reply: still PENDING, so a retry runs it again with the same key
    }
    const completed = await this.dataSource.transaction(async (manager) => {
      // the provider's success is authoritative: it replaces PENDING and a FAILED that a concurrent run wrote, never a
      // COMPLETED. The outcome and the writes it causes (the profile status, an outbox row) commit together, and only
      // when this run's status write is the one that changed the row: the run that lost writes nothing here
      const rows = await this.verifications.withManager(manager).update(
        { id: verification.id, status: In([KycVerificationStatus.PENDING, KycVerificationStatus.FAILED]) },
        { status: KycVerificationStatus.COMPLETED, decision: result.decision, providerReference: result.providerReference },
      );
      if (rows === 1) {
        await this.effects.completed(manager, verification, result); // the outcome is in result, never in the pre-call row
      }
      return rows;
    });
    if (completed === 0) {
      // another run completed it first: its stored result is the outcome of this operation, for every caller
      const decision = await this.completedDecision(verification.id);
      if (decision === undefined) {
        throw new KycVerificationNotFound(); // the row is gone
      }
      return decision;
    }
    return result.decision;
  }

  /** The stored decision of the operation when it is COMPLETED (reloaded, after a guarded write affected no row). */
  private async completedDecision(verificationId: string): Promise<KycDecision | undefined> {
    const stored = await this.verifications.findOneBy({ id: verificationId });
    return stored?.status === KycVerificationStatus.COMPLETED && stored.decision !== null ? stored.decision : undefined;
  }
}
```
