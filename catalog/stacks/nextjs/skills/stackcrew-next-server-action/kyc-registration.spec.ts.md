Goes to `e2e/kyc-registration.spec.ts`.

```ts
// Default location: e2e/kyc-registration.spec.ts
import { expect, test } from '@playwright/test';
import { E2E_RUN_ID, sessionFile } from './sessions';

// The browser, the page, the form, the server action, auth() and Postgres all run for real (stackcrew-nextjs-testing).
test.describe('eKYC registration', () => {
  test.use({ storageState: sessionFile('applicant') });

  test('a signed-in applicant registers and sees the confirmation', async ({ page }, testInfo) => {
    await page.goto('/kyc');
    await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible();

    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page.getByText('Fill in this field.')).toBeVisible(); // the schema runs in the browser first

    await page.getByLabel('Full name').fill(`Applicant ${E2E_RUN_ID}`);
    await page.getByLabel('Date of birth').fill('1990-04-12');
    await page.getByLabel('Document type').selectOption('PASSPORT');
    await page.getByLabel('Document number').fill('C1234567');
    await page.getByRole('button', { name: 'Submit for verification' }).click();

    const confirmation = page.getByRole('status').filter({ hasText: 'Registration received. We will let you know when your identity is verified.' });
    // a CI retry meets the registration of the first attempt: the same applicant gets CONFLICT, nothing else
    const repeat = page.getByRole('alert').filter({ hasText: 'You have already registered.' });
    await expect(testInfo.retry === 0 ? confirmation : confirmation.or(repeat)).toBeVisible();
  });
});

test.describe('eKYC registration without a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sends the visitor to sign in', async ({ page }) => {
    await page.goto('/kyc');
    await expect(page).toHaveURL(/\/api\/auth\/signin/);
  });
});
```
