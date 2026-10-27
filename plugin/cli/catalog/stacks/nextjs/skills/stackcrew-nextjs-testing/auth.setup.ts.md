Goes to `e2e/auth.setup.ts`.

```ts
// Default location: e2e/auth.setup.ts
import { expect, test as setup } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { E2E_USERS, sessionFile, type E2eUser } from './sessions';

/** next-auth v5's session cookie over http; behind https it is `__Secure-authjs.session-token`. */
const SESSION_COOKIE = 'authjs.session-token';
const SESSION_SECONDS = 3600;

/**
 * Signs every E2E user in once and saves the browser state for the tests (Playwright's setup project). The identity
 * provider's login page cannot run in CI, so this signs the session the way next-auth does after a login: `encode`
 * with the test AUTH_SECRET of .env.test, the cookie name as salt, and the claims the jwt callback of src/auth.ts
 * keeps. Nothing in the app is stubbed: its own auth() decodes and checks this cookie on every request, and the check
 * below proves it. Never run this with a real secret.
 */
for (const user of Object.keys(E2E_USERS) as E2eUser[]) {
  setup(`sign in as ${user}`, async ({ context, baseURL }) => {
    const secret = process.env.AUTH_SECRET;
    if (secret === undefined || baseURL === undefined) {
      throw new Error('playwright.config.ts sets AUTH_SECRET (from .env.test) and baseURL');
    }
    const { sub, tenantId, roles } = E2E_USERS[user];
    const value = await encode({ token: { sub, name: sub, tenantId, roles: [...roles] }, secret, salt: SESSION_COOKIE, maxAge: SESSION_SECONDS });
    await context.addCookies([{ name: SESSION_COOKIE, value, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);

    const session: unknown = await (await context.request.get('/api/auth/session')).json();
    expect(session).toMatchObject({ user: { id: sub, tenantId, roles: [...roles] } }); // the app's auth() accepts it

    await context.storageState({ path: sessionFile(user) });
  });
}
```
