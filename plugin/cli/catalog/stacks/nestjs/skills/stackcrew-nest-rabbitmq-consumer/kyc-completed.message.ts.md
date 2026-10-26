Goes to `src/modules/customer-profiles/messaging/kyc-completed.message.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-completed.message.ts
import { Equals, IsIn, IsISO8601, IsUUID } from 'class-validator';
import type { MessageEnvelope } from '../../../common/messaging/messaging.types';

export const KYC_COMPLETED_TYPE = 'kyc.completed';
export const KYC_COMPLETED_VERSION = 1;

export const KycOutcome = { APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type KycOutcome = (typeof KycOutcome)[keyof typeof KycOutcome];

/**
 * kyc.completed, version 1: the KYC service finished a verification. The schema of the payload, checked once by the
 * codec; nothing past the codec sees unparsed data. messageId is the dedupe key. A breaking change is a new version
 * with its own class, consumed side by side until producers have moved.
 */
export class KycCompletedMessage implements MessageEnvelope {
  @IsUUID()
  readonly messageId!: string;

  @Equals(KYC_COMPLETED_TYPE)
  readonly type!: typeof KYC_COMPLETED_TYPE;

  @Equals(KYC_COMPLETED_VERSION)
  readonly version!: number;

  @IsISO8601({ strict: true })
  readonly occurredAt!: string;

  @IsUUID()
  readonly profileId!: string;

  @IsIn(Object.values(KycOutcome))
  readonly outcome!: KycOutcome;
}
```
