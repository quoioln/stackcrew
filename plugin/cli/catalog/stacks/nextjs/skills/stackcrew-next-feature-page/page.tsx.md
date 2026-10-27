Goes to `src/app/kyc/registrations/page.tsx`.

```tsx
// Default location: src/app/kyc/registrations/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { KycRegistrationTable } from '../../../features/kyc-registrations/components/kyc-registration-table';
import { loadKycRegistrationPage } from '../../../features/kyc-registrations/data';
import { kycRegistrationListText as text } from '../../../features/kyc-registrations/kyc-registration-list.messages';
import { KycPath } from '../../../features/kyc-registrations/kyc-registration.constants';
import { ActionErrorCode } from '../../../shared/action-result';
import { lastPage, pageQueryOrDefault } from '../../../shared/pagination';

/**
 * An async Server Component: it loads its data on the server through the 'server-only' loader and gives the client
 * table DTOs only. Next.js shows loading.tsx while it awaits and error.tsx when it throws; the empty state and the
 * refusals are rendered here. It reads the session (through the loader), so it is rendered per request.
 */
export default async function KycRegistrationsPage(props: PageProps<'/kyc/registrations'>) {
  const query = pageQueryOrDefault(await props.searchParams);
  const result = await loadKycRegistrationPage(query);
  if (!result.ok) {
    if (result.error.code === ActionErrorCode.UNAUTHENTICATED) {
      redirect(`${KycPath.SIGN_IN}?callbackUrl=${encodeURIComponent(KycPath.REGISTRATIONS)}`);
    }
    return (
      <main className="mx-auto grid max-w-5xl gap-6 p-6">
        <h1 className="text-2xl font-semibold">{text.title}</h1>
        <p role="alert" className="text-sm text-destructive">{text.forbidden}</p>
      </main>
    );
  }

  const registrations = result.data;
  const pages = lastPage(registrations);
  const linkClass = cn(buttonVariants({ variant: 'outline', size: 'sm' }));
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6">
      <h1 className="text-2xl font-semibold">{text.title}</h1>
      {registrations.total === 0 ? (
        <section className="grid gap-2 rounded-lg border border-dashed p-10 text-center">
          <h2 className="text-lg font-medium">{text.emptyTitle}</h2>
          <p className="text-sm text-muted-foreground">{text.emptyBody}</p>
        </section>
      ) : (
        <>
          <KycRegistrationTable rows={registrations.items} />
          <nav aria-label={text.pages} className="flex items-center justify-between gap-4 text-sm">
            <span>{text.pageStatus(registrations.page, pages)}</span>
            <span className="flex gap-2">
              {registrations.page > 1 && (
                <Link className={linkClass} href={{ query: { page: registrations.page - 1 } }}>
                  {text.previous}
                </Link>
              )}
              {registrations.page < pages && (
                <Link className={linkClass} href={{ query: { page: registrations.page + 1 } }}>
                  {text.next}
                </Link>
              )}
            </span>
          </nav>
        </>
      )}
    </main>
  );
}
```
