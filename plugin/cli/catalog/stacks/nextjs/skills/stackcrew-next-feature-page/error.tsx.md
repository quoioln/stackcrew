Goes to `src/app/kyc/registrations/error.tsx`.

```tsx
// Default location: src/app/kyc/registrations/error.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
// Shared components: imports use the project's alias for {{sc:sharedComponents}} (shadcn components.json → aliases.ui;
// cn at aliases.utils). These assume @/components/ui and @/lib/utils.
import { Button } from '@/components/ui/button';
import { kycRegistrationListText as text } from '../../../features/kyc-registrations/kyc-registration-list.messages';

/**
 * The segment's error boundary (a Client Component). It shows constant text and the digest, the reference that
 * onRequestError logged with the error, never error.message. "Try again" fetches the Server Components again
 * (router.refresh()) and clears the boundary (reset()) in one transition. Next.js 16.0 passes only `reset`; later 16.x
 * releases also pass a retry function that does both, which a project on those versions may use instead.
 */
export default function KycRegistrationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-6">
      <h1 className="text-2xl font-semibold">{text.title}</h1>
      <div role="alert" className="grid gap-2 rounded-lg border border-destructive/50 p-4">
        <h2 className="font-medium">{text.errorTitle}</h2>
        <p className="text-sm text-muted-foreground">{text.errorBody}</p>
        {error.digest !== undefined && <p className="text-xs text-muted-foreground">{text.errorReference(error.digest)}</p>}
      </div>
      <div>
        <Button
          disabled={retrying}
          onClick={() => {
            startTransition(() => {
              router.refresh();
              reset();
            });
          }}
        >
          {text.retry}
        </Button>
      </div>
    </main>
  );
}
```
