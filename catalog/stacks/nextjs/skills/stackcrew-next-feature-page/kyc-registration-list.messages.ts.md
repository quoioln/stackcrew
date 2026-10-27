Goes to `src/features/kyc-registrations/kyc-registration-list.messages.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration-list.messages.ts
import type { KycRegistrationStatus } from './kyc-registration.constants';

/**
 * The text of the reviewers' page, in one catalog (core-frontend); messages with values are functions, never
 * concatenated fragments. With an i18n library in the project these become keys of its catalog. The locale and time
 * zone are fixed so the server render and the browser format a date the same way (no hydration mismatch).
 */
export const kycRegistrationListText = {
  title: 'Identity registrations',
  caption: 'Identity registrations of your organization, newest first',
  locale: 'en-US',
  timeZone: 'UTC',
  columns: { fullName: 'Full name', documentType: 'Document', status: 'Status', submittedAt: 'Submitted' },
  statuses: { PENDING: 'Waiting for review', VERIFIED: 'Verified', REJECTED: 'Rejected' } satisfies Record<KycRegistrationStatus, string>,
  emptyTitle: 'No registrations yet',
  emptyBody: 'Registrations appear here as soon as applicants submit them.',
  noRows: 'No registrations on this page.',
  forbidden: 'You do not have access to identity registrations.',
  loading: 'Loading registrations',
  pages: 'Pages',
  previous: 'Previous page',
  next: 'Next page',
  pageStatus: (page: number, pages: number): string => `Page ${page} of ${pages}`,
  errorTitle: 'The registrations could not be loaded',
  errorBody: 'This is on our side. Try again in a moment.',
  errorReference: (digest: string): string => `Reference: ${digest}`,
  retry: 'Try again',
} as const;
```
