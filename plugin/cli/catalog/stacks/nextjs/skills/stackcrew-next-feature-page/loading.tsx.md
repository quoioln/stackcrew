Goes to `src/app/kyc/registrations/loading.tsx`.

```tsx
// Default location: src/app/kyc/registrations/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { kycRegistrationListText as text } from '../../../features/kyc-registrations/kyc-registration-list.messages';

const PLACEHOLDER_ROWS = 5;

/** Shown at once, streamed before the page's data arrives: the page's layout with placeholders, announced to screen readers. */
export default function KycRegistrationsLoading() {
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6" aria-busy="true">
      <h1 className="text-2xl font-semibold">{text.title}</h1>
      <p role="status" className="sr-only">{text.loading}</p>
      <div className="grid gap-2">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    </main>
  );
}
```
