Goes to `e2e/kyc-registrations-page.spec.ts`.

```ts
// Default location: e2e/kyc-registrations-page.spec.ts
import { expect, test, type Browser } from '@playwright/test';
import { E2E_RUN_ID, sessionFile, type E2eUser } from './sessions';

const APPLICANT_NAME = `Listed Applicant ${E2E_RUN_ID}`;

/** A page signed in as that E2E user (auth.setup.ts), in its own browser context. */
const signedIn = async (browser: Browser, user: E2eUser) => (await browser.newContext({ storageState: sessionFile(user) })).newPage();

// An async Server Component is tested here, not in Vitest: the real page, loader, tenant repository and Postgres.
test.describe('identity registrations page', () => {
  test.describe.configure({ mode: 'default' }); // in order, in one worker: the seed runs once

  test.beforeAll(async ({ browser }) => {
    // seed through the app's own code: the applicant registers with the form, in tenant A
    const page = await signedIn(browser, 'listedApplicant');
    await page.goto('/kyc');
    await page.getByLabel('Full name').fill(APPLICANT_NAME);
    await page.getByLabel('Date of birth').fill('1988-11-02');
    await page.getByLabel('Document number').fill('079088004321');
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    // a retry finds the registration already there (CONFLICT): the seed is idempotent
    await expect(page.getByRole('status').or(page.getByText('You have already registered.', { exact: false }))).toBeVisible();
    await page.context().close();
  });

  test('a reviewer sees the registrations of their tenant, without the document number', async ({ browser }) => {
    const page = await signedIn(browser, 'reviewer');
    await page.goto('/kyc/registrations');

    const row = page.getByRole('row').filter({ hasText: APPLICANT_NAME });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell')).toHaveText([APPLICANT_NAME, 'National ID card', 'Waiting for review', /\d{4}/]);
    await expect(page.getByText('079088004321')).toHaveCount(0);
  });

  test('a reviewer of another tenant sees the empty state and none of tenant A rows', async ({ browser }) => {
    const page = await signedIn(browser, 'otherTenantReviewer');
    await page.goto('/kyc/registrations');

    await expect(page.getByRole('heading', { name: 'No registrations yet' })).toBeVisible();
    await expect(page.getByText(APPLICANT_NAME)).toHaveCount(0);
  });

  test('an applicant is refused the list', async ({ browser }) => {
    const page = await signedIn(browser, 'applicant');
    await page.goto('/kyc/registrations');

    // filtered by text: Next.js renders its own route announcer with role=alert on every page
    await expect(page.getByRole('alert').filter({ hasText: 'You do not have access to identity registrations.' })).toBeVisible();
  });
});
```
