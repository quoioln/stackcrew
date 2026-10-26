Goes to `src/modules/customer-profiles/messaging/kyc-completed.handler.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-completed.handler.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NonRetryableMessageError, ParkReason } from '../../../common/messaging/message-errors';
import { ProcessedMessageStore } from '../../../common/messaging/processed-message.store';
import { CustomerProfileRepository } from '../customer-profile.repository';
import { CustomerProfileStatus } from '../entities/customer-profile.entity';
import { KycOutcome, type KycCompletedMessage } from './kyc-completed.message';
import { KYC_COMPLETED_CONSUMER } from './kyc-messaging.constants';

const STATUS_BY_OUTCOME: Readonly<Record<KycOutcome, CustomerProfileStatus>> = {
  [KycOutcome.APPROVED]: CustomerProfileStatus.VERIFIED,
  [KycOutcome.REJECTED]: CustomerProfileStatus.REJECTED,
};

/** The profile is not in the message's tenant (or does not exist): another attempt would find the same. */
export class ProfileNotInTenantError extends NonRetryableMessageError {
  constructor() {
    super(ParkReason.BUSINESS_RULE);
  }
}

/**
 * Applies kyc.completed once. The idempotency marker and the status change share one transaction: a failure rolls
 * both back so the next attempt applies the message, and a duplicate finds the marker and changes nothing. The tenant
 * is the one the consumer took from x-tenant-id; the repository adds it to the update, so another tenant's profile is
 * never touched. No remote call happens inside the transaction.
 */
@Injectable()
export class KycCompletedHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profiles: CustomerProfileRepository,
    private readonly processed: ProcessedMessageStore,
  ) {}

  /** True when the message was applied, false for a duplicate. */
  async handle(message: KycCompletedMessage): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.processed.markIfNew(manager, KYC_COMPLETED_CONSUMER, message.messageId))) {
        return false;
      }
      const changed = await this.profiles.withManager(manager).update({ id: message.profileId }, { status: STATUS_BY_OUTCOME[message.outcome] });
      if (changed === 0) {
        throw new ProfileNotInTenantError(); // rolls the marker back too
      }
      return true;
    });
  }
}
```
