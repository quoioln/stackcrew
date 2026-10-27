Goes to `src/features/kyc-registrations/kyc-registration.messages.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.messages.ts
import type { ActionErrorCode } from '../../shared/action-result';
import type { DocumentType } from './kyc-registration.constants';

/**
 * The user-facing text of the registration form, in one catalog (core-frontend): the form, the schema's messages and
 * the refusals read it, and no component holds a literal. With next-intl or another i18n library in the project these
 * become keys in its catalog (adding one is a new dependency: ask the user first). Messages are constant: they never
 * quote what the user typed, because they also reach the log line.
 */
export const kycRegistrationText = {
  title: 'Verify your identity',
  intro: 'We use these details once, to check your identity document.',
  fields: { fullName: 'Full name', dateOfBirth: 'Date of birth', documentType: 'Document type', idNumber: 'Document number' },
  documentTypes: { NATIONAL_ID: 'National ID card', PASSPORT: 'Passport' } satisfies Record<DocumentType, string>,
  submit: 'Submit for verification',
  submitting: 'Submitting…',
  submitted: 'Registration received. We will let you know when your identity is verified.',
  errors: {
    required: 'Fill in this field.',
    tooLong: 'This is too long.',
    invalidDate: 'Enter a real date in the past.',
    documentType: 'Choose a document type.',
    idNumber: 'Use 6 to 20 capital letters and digits.',
  },
  refusals: {
    VALIDATION: 'Check the highlighted fields.',
    UNAUTHENTICATED: 'Your session has ended. Sign in again to continue.',
    FORBIDDEN: 'Your account cannot register for identity verification.',
    NOT_FOUND: 'This registration no longer exists.',
    CONFLICT: 'You have already registered. Your registration is being reviewed.',
  } satisfies Record<ActionErrorCode, string>,
  unexpected: 'Something went wrong. Try again in a moment.',
} as const;
```
