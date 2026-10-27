Goes to `e2e/sessions.ts`.

```ts
// Default location: e2e/sessions.ts
import path from 'node:path';

/**
 * One id per Playwright run, set by playwright.config.ts before the workers start, so every worker sees the same one.
 * Users and the second tenant carry it: each run starts with data no earlier run touched, so the tests need no cleanup
 * and never depend on order.
 */
export const E2E_RUN_ID = process.env.E2E_RUN_ID ?? 'local';

/** The signed-in users of the E2E run: the claims src/auth.ts keeps in the session (sub, tenant, roles). */
export const E2E_USERS = {
  applicant: { sub: `e2e-applicant-${E2E_RUN_ID}`, tenantId: 'e2e-tenant-a', roles: ['kyc_applicant'] },
  listedApplicant: { sub: `e2e-listed-${E2E_RUN_ID}`, tenantId: 'e2e-tenant-a', roles: ['kyc_applicant'] },
  reviewer: { sub: `e2e-reviewer-${E2E_RUN_ID}`, tenantId: 'e2e-tenant-a', roles: ['kyc_reviewer'] },
  otherTenantReviewer: { sub: `e2e-reviewer-b-${E2E_RUN_ID}`, tenantId: `e2e-tenant-b-${E2E_RUN_ID}`, roles: ['kyc_reviewer'] },
} as const;

export type E2eUser = keyof typeof E2E_USERS;

/** The browser state (the session cookie) auth.setup.ts saved for a user: `test.use({ storageState: sessionFile('reviewer') })`. */
export function sessionFile(user: E2eUser): string {
  return path.join('playwright', '.auth', `${user}.json`);
}
```
