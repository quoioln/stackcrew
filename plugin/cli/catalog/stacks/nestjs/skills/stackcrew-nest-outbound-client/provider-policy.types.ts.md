Goes to `src/common/providers/provider-policy.types.ts`.

```ts
// Default location: src/common/providers/provider-policy.types.ts

/** Resilience settings of one provider client. The timeout itself is the HttpService `timeout` (per attempt). */
export type ProviderPolicyOptions = {
  /** Retries after the first attempt (cockatiel `maxAttempts`). Only for idempotent calls or calls with an idempotency key. */
  readonly maxRetries: number;
  /** Exponential backoff with jitter between attempts. */
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Consecutive failed calls (each after its retries) that open the circuit. */
  readonly breakAfter: number;
  /** How long an open circuit fails fast before one trial call. */
  readonly halfOpenAfterMs: number;
  /** Bulkhead: attempts in flight at once, and calls that may wait for a slot. */
  readonly maxConcurrent: number;
  readonly maxQueued: number;
};

/** Runs one logical call through the policy. */
export type ProviderCall = <T>(attempt: () => Promise<T>) => Promise<T>;
```
