Goes to `src/app/kyc/page.tsx`.

```tsx
// Default location: src/app/kyc/page.tsx
import { redirect } from 'next/navigation';
import { KycRegistrationForm } from '../../features/kyc-registrations/components/kyc-registration-form';
import { KycPath } from '../../features/kyc-registrations/kyc-registration.constants';
import { kycRegistrationText as text } from '../../features/kyc-registrations/kyc-registration.messages';
import { getRequestContext } from '../../shared/context/session-context';

/**
 * The applicant's page: a Server Component around the client form. It sends a visitor without a session to sign in;
 * the action still checks the caller itself, because an action is callable without this page.
 */
export default async function KycPage() {
  const caller = await getRequestContext();
  if (caller.userId === undefined) {
    redirect(`${KycPath.SIGN_IN}?callbackUrl=${encodeURIComponent(KycPath.REGISTER)}`);
  }
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-6">
      <h1 className="text-2xl font-semibold">{text.title}</h1>
      <KycRegistrationForm />
    </main>
  );
}
```
