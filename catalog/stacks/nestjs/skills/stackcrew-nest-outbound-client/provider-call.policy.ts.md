Goes to `src/common/providers/provider-call.policy.ts`.

```ts
// Default location: src/common/providers/provider-call.policy.ts
import { bulkhead, circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleWhen, isBrokenCircuitError, isBulkheadRejectedError, retry, wrap } from 'cockatiel';
import type { ProviderCall, ProviderPolicyOptions } from './provider-policy.types';
import { ProviderUnavailableError } from './provider.errors';

/** Only transient trouble is retried and counted by the breaker: never a rejection (4xx) or an invalid reply. */
const transient = handleWhen((error: unknown) => error instanceof ProviderUnavailableError);

/**
 * The resilience policy of one provider client (cockatiel), outermost first: a circuit breaker (one logical call, its
 * retries included, is one breaker record), a retry with exponential backoff and jitter, and a bulkhead that caps the
 * attempts in flight. The per-attempt timeout is the HttpService `timeout`. Create one per client, in its constructor:
 * the breaker's state must be shared by every call to that provider.
 */
export function providerCallPolicy(options: ProviderPolicyOptions): ProviderCall {
  const policy = wrap(
    circuitBreaker(transient, { halfOpenAfter: options.halfOpenAfterMs, breaker: new ConsecutiveBreaker(options.breakAfter) }),
    retry(transient, { maxAttempts: options.maxRetries, backoff: new ExponentialBackoff({ initialDelay: options.initialDelayMs, maxDelay: options.maxDelayMs }) }),
    bulkhead(options.maxConcurrent, options.maxQueued),
  );
  return async <T>(attempt: () => Promise<T>): Promise<T> => {
    try {
      return await policy.execute(() => attempt());
    } catch (error: unknown) {
      if (isBrokenCircuitError(error) || isBulkheadRejectedError(error)) {
        throw new ProviderUnavailableError(); // fail fast: the circuit is open or every slot is taken
      }
      throw error;
    }
  };
}
```
