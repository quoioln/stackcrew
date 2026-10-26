Goes to `src/modules/customer-profiles/messaging/kyc-messaging.constants.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-messaging.constants.ts
import type { WorkQueue } from '../../../common/messaging/messaging.types';

/** This consumer's name in the idempotency store: one per queue. */
export const KYC_COMPLETED_CONSUMER = 'customer-profiles.kyc-completed';

/** kyc.completed from the KYC service's exchange, into this service's own queue. Documented topology, versioned here. */
export const KYC_COMPLETED_QUEUE: WorkQueue = {
  exchange: 'kyc.events',
  routingKey: 'kyc.completed',
  queue: 'customer-profiles.kyc-completed',
  retryDelayMs: 5_000,
  maxAttempts: 3,
  prefetch: 10,
};
```
