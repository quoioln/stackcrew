Goes to `playwright.config.ts`.

```ts
// Default location: playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';
import { sessionFile } from './e2e/sessions';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_START_MS = 120_000;

/** .env.test (and .env.test.local), as the Vitest configs load it: the test database and the test AUTH_SECRET. */
const testEnv = loadEnv('test', process.cwd(), '');
process.env.AUTH_SECRET ??= testEnv.AUTH_SECRET; // auth.setup.ts signs the sessions with it
process.env.E2E_RUN_ID ??= Date.now().toString(36); // set before the workers start, so they share it (e2e/sessions.ts)

/**
 * E2E against a production build: `next build` first (CI does it in its own step), then this file starts `next start`
 * with the test environment. The database must have the migrations (TypeORM CLI, migration:run) before the run.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // signed in as the applicant unless a test says otherwise with test.use({ storageState })
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: sessionFile('applicant') }, dependencies: ['setup'] },
  ],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: BASE_URL,
    env: { ...testEnv, AUTH_TRUST_HOST: 'true' },
    reuseExistingServer: process.env.CI === undefined,
    timeout: SERVER_START_MS,
  },
});
```
