Goes to `src/features/kyc-registrations/kyc-registration.constants.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.constants.ts
/**
 * Values the schema, the form, the entity and the pages share. This file imports nothing: the browser loads it through
 * the schema and the form, so it must never pull in the entity (TypeORM) or a server module.
 */
export const DocumentType = { NATIONAL_ID: 'NATIONAL_ID', PASSPORT: 'PASSPORT' } as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];
export const DOCUMENT_TYPES = [DocumentType.NATIONAL_ID, DocumentType.PASSPORT] as const;

export const KycRegistrationStatus = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' } as const;
export type KycRegistrationStatus = (typeof KycRegistrationStatus)[keyof typeof KycRegistrationStatus];

/** Roles (session claim `{{sc:rolesClaim}}`): who may register their own identity, and who may review the tenant's registrations. */
export const KycRole = { APPLICANT: 'kyc_applicant', REVIEWER: 'kyc_reviewer' } as const;

export const FULL_NAME_MAX = 200;
export const ID_NUMBER_MIN = 6;
export const ID_NUMBER_MAX = 20;
/** The identity provider's `sub`; the same length as createdBy and updatedBy. */
export const APPLICANT_ID_MAX = 128;

export const KycPath = {
  REGISTER: '/kyc',
  REGISTRATIONS: '/kyc/registrations',
  /** next-auth's sign-in page; a project with its own sign-in page uses that path. */
  SIGN_IN: '/api/auth/signin',
} as const;
```
