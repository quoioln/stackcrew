Goes to `src/common/messaging/work-queue.spec.ts`.

```ts
// Default location: src/common/messaging/work-queue.spec.ts
import { failedDeliveries } from './work-queue';

const QUEUE = 'orders.created';
const death = (queue: string, reason: string, count: unknown): Record<string, unknown> => ({ queue, reason, count, exchange: '', 'routing-keys': [queue] });

describe('failedDeliveries', () => {
  it('is 0 for a first delivery', () => {
    expect(failedDeliveries(undefined, QUEUE)).toBe(0);
    expect(failedDeliveries({}, QUEUE)).toBe(0);
  });

  it('reads the broker count of rejections from this queue only', () => {
    const headers = { 'x-death': [death(`${QUEUE}.wait`, 'expired', 2), death(QUEUE, 'rejected', 2), death('other', 'rejected', 7)] };
    expect(failedDeliveries(headers, QUEUE)).toBe(2);
  });

  it('ignores a malformed x-death header', () => {
    expect(failedDeliveries({ 'x-death': 'three' }, QUEUE)).toBe(0);
    expect(failedDeliveries({ 'x-death': [death(QUEUE, 'rejected', '3'), null] }, QUEUE)).toBe(0);
  });
});
```
