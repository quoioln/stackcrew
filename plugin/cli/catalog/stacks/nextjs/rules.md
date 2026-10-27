---
id: stack-nextjs
title: Next.js 16
---
# Next.js 16

Next.js 16 App Router with React 19 and TypeScript strict, used full-stack: Server Components, server actions and route handlers read the database directly with TypeORM. Applies with the TypeScript rule (SC-TYPE, SC-ENV, SC-CONST, SC-TYPEFILE). A new dependency is added only after you ask the user first.

## Essentials

- Server Components by default. `'use client'` only on the leaf component that needs state, effects or browser APIs; pass it serializable props, never a function or a class instance.
- Code that touches the database, a secret or a repository starts with `import 'server-only'`. Entities never reach the client: Server Components, server actions and route handlers map them to DTOs or plain objects first.
- A server action parses its input with a zod schema kept in its own file (`schemas/`, type by `z.infer`), checks the caller and their permissions through `getRequestContext()` (which calls `auth()`), returns a typed result `{ ok: true, data } | { ok: false, error }`, calls `revalidatePath`/`revalidateTag` after a write, and is wrapped with `withActionLogging`. An actions file declares no `interface` or `type` (SC-TYPEFILE).
- Route handlers are wrapped with `withRouteLogging`; outbound HTTP goes through `httpClient.fetch`; `onRequestError` in `instrumentation.ts` logs what escapes (skill `stackcrew-next-request-logging`, `core-logging`). Bodies are logged only by these, through the shared masker.
- Forms use `react-hook-form` with `zodResolver` on the same schema the action parses. The action validates again: client validation is for the user, not for security.
- Reuse before you write: components in `{{sc:sharedComponents}}` and the feature's existing components first; tables use the shared TanStack Table component. Never write a second button, input, dialog or table.
- Classes go through `cn()` (`clsx` + `tailwind-merge`) and the design tokens of Tailwind 4; no inline `style`, no hardcoded colors.
- Environment variables only through the `env` object of `@t3-oss/env-nextjs` in `src/env.ts` (SC-ENV); never `process.env` in a component, action or route.
- `zustand` holds client UI state only (open panels, selections, wizard steps). Server data comes from Server Components or server actions, never from a client store.
- Every page has its loading, empty and error states: `loading.tsx`, `error.tsx` (a Client Component with a retry button) and an empty state in the page.
- Persistence per `addon-typeorm`: one `DataSource` per server layer kept on `globalThis`, `typeorm` in `serverExternalPackages`, `experimentalDecorators` in `tsconfig.json`, tenant entities only through `TenantScopedRepository` (skill `stackcrew-next-typeorm-entity`).
- Write tests per `stack-nextjs-testing`: Vitest for schemas, mappers and actions; Testing Library for client components; Playwright for async Server Components.

## Layout

```
src/
  app/                          # routes only: page.tsx, layout.tsx, loading.tsx, error.tsx, route.ts
  auth.ts                       # NextAuth: handlers, auth, signIn, signOut
  env.ts                        # createEnv: every variable, validated at build and boot
  instrumentation.ts            # onRequestError
  shared/{context,logging,db}/  # request context, logging wrappers, DataSource and base entities
  shared/action-result.ts       # ActionResult, ok(), fail()
  features/customer-profiles/
    actions.ts                  # 'use server': wrapped actions only, no types
    schemas/create-customer-profile.schema.ts
    customer-profile.dto.ts     # the shape that reaches the client
    customer-profile.mapper.ts  # entity -> DTO
    customer-profile.entity.ts
    customer-profile.repository.ts
    data.ts                     # 'server-only' loaders for Server Components
    components/                 # feature components; shared ones live in {{sc:sharedComponents}}
```

- Feature code lives in `src/features/<feature>/`; `app/` holds routing files that import from it. Shared code lives in `src/shared/` (the default when the project has no `lib/` or `server/` folder of its own).
- Status and type values are `as const` objects next to the entity or in `<feature>.constants.ts` (SC-CONST).

## Server and client

- Data loads in Server Components through a `'server-only'` loader that runs in the request context: `export const loadProfiles = (page: number) => runInRequestContext(async () => ...)`. Without `runInRequestContext` a tenant repository throws `MissingTenantError`.
- Props crossing to a Client Component are DTOs: plain objects of strings, numbers, booleans, arrays and ISO date strings. A `Date`, a `Map` or a class instance does not cross; an entity never does.
- Read the user only through `getRequestContext()` (`src/shared/context/session-context.ts`): the context of the wrapping action or route, or, in a Server Component, the context built from `auth()` once per request. Never read the session cookie or a header for the user.

## Server actions

```ts
// src/features/customer-profiles/schemas/create-customer-profile.schema.ts
import { z } from 'zod';

const FULL_NAME_MAX = 200;
const REFERENCE_MAX = 64;

export const createCustomerProfileSchema = z.object({
  reference: z.string().trim().min(1).max(REFERENCE_MAX),
  fullName: z.string().trim().min(1).max(FULL_NAME_MAX),
});
export type CreateCustomerProfileInput = z.infer<typeof createCustomerProfileSchema>;
```

```ts
// src/features/customer-profiles/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { ActionErrorCode, fail, ok, type ActionResult } from '../../shared/action-result';
import { getRequestContext } from '../../shared/context/session-context';
import { withActionLogging } from '../../shared/logging/with-action-logging';
import type { CustomerProfileDto } from './customer-profile.dto';
import { CustomerProfileStatus } from './customer-profile.entity';
import { toCustomerProfileDto } from './customer-profile.mapper';
import { customerProfiles } from './customer-profile.repository';
import { createCustomerProfileSchema } from './schemas/create-customer-profile.schema';

const PROFILES_PATH = '/customer-profiles';
const CREATE_ROLE = 'profile_editor';

/** Input is unknown at the edge: a form, a fetch from another site, a replayed request. The schema decides. */
export const createCustomerProfile = withActionLogging('createCustomerProfile', async (input: unknown): Promise<ActionResult<CustomerProfileDto>> => {
  const caller = await getRequestContext();
  if (caller.userId === undefined) {
    return fail(ActionErrorCode.UNAUTHENTICATED);
  }
  if (!caller.roles.includes(CREATE_ROLE)) {
    return fail(ActionErrorCode.FORBIDDEN);
  }
  const parsed = createCustomerProfileSchema.safeParse(input);
  if (!parsed.success) {
    return fail(ActionErrorCode.VALIDATION, parsed.error.flatten().fieldErrors);
  }
  const profiles = await customerProfiles();
  const saved = await profiles.save(profiles.create({ ...parsed.data, status: CustomerProfileStatus.PENDING }));
  revalidatePath(PROFILES_PATH);
  return ok(toCustomerProfileDto(saved));
});
```

```ts
// src/features/customer-profiles/customer-profile.dto.ts
import type { CustomerProfileStatus } from './customer-profile.entity';

/** What reaches the client: no tenant, no audit field, dates as ISO strings. */
export type CustomerProfileDto = {
  readonly id: string;
  readonly reference: string;
  readonly fullName: string;
  readonly status: CustomerProfileStatus;
  readonly createdAt: string;
};
```

```ts
// src/features/customer-profiles/customer-profile.mapper.ts
import type { CustomerProfileDto } from './customer-profile.dto';
import type { CustomerProfile } from './customer-profile.entity';

/** The one place that knows both shapes. Copies field by field, so a column added later never leaks. */
export function toCustomerProfileDto(entity: CustomerProfile): CustomerProfileDto {
  return { id: entity.id, reference: entity.reference, fullName: entity.fullName, status: entity.status, createdAt: entity.createdAt.toISOString() };
}
```

- A `'use server'` file exports only the wrapped async actions. Every exported action is a public POST endpoint: authenticate, authorize and validate in the action itself, whatever the page around it checks.
- Expected refusals (validation, sign-in, permission, not found, conflict) are typed results with an `ActionErrorCode`; the client branches on `result.ok`. Only unexpected failures throw: they reach `error.tsx` and are logged as 500 by the wrapper and `onRequestError`.
- `redirect()` and `notFound()` work by throwing: call them outside any `try`, or call `unstable_rethrow(error)` first in the `catch`. The wrapper logs them at their status and rethrows them.
- The result is serializable data: a DTO, never an entity, a `Date` or a class instance.

## Forms

- The form is a Client Component: `useForm<CreateCustomerProfileInput>({ resolver: zodResolver(createCustomerProfileSchema) })`, the action called in `handleSubmit`, and `result.error.fieldErrors` mapped back with `setError`. Inputs, labels and the submit button come from `{{sc:sharedComponents}}`.
- Disable the submit button while the action runs; show the refusal the result carries, never a raw exception.

## Authentication

`next-auth` v5 with the project's OIDC provider. The callbacks copy `sub`, claim `{{sc:tenantClaim}}` and claim `{{sc:rolesClaim}}` into the session once, at sign-in; `toAuthUser` parses them at the edge (request-logging skill):

```ts
// src/auth.ts
import NextAuth from 'next-auth';
import type {} from 'next-auth/jwt'; // brings the module into scope for the JWT augmentation below
import { env } from './env';

const TENANT_CLAIM = '{{sc:tenantClaim}}';
const ROLES_CLAIM = '{{sc:rolesClaim}}';

declare module 'next-auth' {
  interface User {
    tenantId?: string;
    roles?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string;
    roles?: string[];
  }
}

const claimText = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const claimList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [{ id: 'idp', name: 'Identity provider', type: 'oidc', issuer: env.AUTH_ISSUER, clientId: env.AUTH_CLIENT_ID, clientSecret: env.AUTH_CLIENT_SECRET }],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, profile }) {
      if (profile !== undefined && profile !== null) {
        token.tenantId = claimText(profile[TENANT_CLAIM]);
        token.roles = claimList(profile[ROLES_CLAIM]);
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.tenantId = token.tenantId;
      session.user.roles = token.roles ?? [];
      return session;
    },
  },
});
```

```ts
// src/env.ts (add to server)
AUTH_ISSUER: z.string().url(),
AUTH_CLIENT_ID: z.string().min(1),
AUTH_CLIENT_SECRET: z.string().min(1),
```

- `app/api/auth/[...nextauth]/route.ts` exports `const { GET, POST } = handlers`. `AUTH_SECRET` is read by next-auth itself; it is never in the repository.
- `proxy.ts` may refresh the session, but it is not an authorization check: actions, route handlers and loaders check the caller themselves.

## Persistence

Per `addon-typeorm` and skill `stackcrew-next-typeorm-entity`:

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // TypeORM loads its database driver and optional packages with runtime require() calls the bundler cannot follow,
  // so it stays a Node.js require. pg and pino are already on the built-in list of Next.js.
  serverExternalPackages: ['typeorm'],
};

export default nextConfig;
```

- `tsconfig.json` sets `"experimentalDecorators": true`; every column names its `type`, because Vitest never emits decorator metadata and Next.js only with `emitDecoratorMetadata`. Tables, indexes, constraints and migrations have explicit names: the production build minifies class names.
- One `DataSource` per server layer through `getDataSource()`, kept on `globalThis` so `next dev` does not open a pool per edit. Next.js evaluates server modules once for Server Components and actions and again for route handlers, each with its own entity classes, so a single process-wide instance would serve one layer only; size the pool knowing there are two. Entities, subscribers and migrations are listed by class in `data-source.options.ts`, never by path glob.
- Tenant entities only through their `TenantScopedRepository`; a lookup by id of another tenant's row returns `null` and becomes `notFound()` or `NOT_FOUND`, and so does a `CrossTenantDeniedError` (catch it where the refusal is decided). Cross-tenant reads only through `runCrossTenant(reason, work)`, allowed for `CROSS_TENANT_ROLES` (default {{sc:crossTenantRoles}}) and the system job entry `runAsSystem`.
- Transactions: `dataSource.transaction(async (manager) => ...)`, and inside it a tenant entity only through its repository's `withManager(manager)`. Never use any manager method on a tenant entity (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…): none carries the tenant condition. Never a remote call inside a transaction.

## Errors, logging and observability

- `error.tsx` shows a constant message and a retry; never `error.message`, which Next.js hides in production anyway. `not-found.tsx` covers `notFound()`.
- Next.js itself prints an uncaught server error with its message to stderr: never put input, a token or PII in an error message.
- In code, `logger.info({ event, ...fields }, event)` from `src/shared/logging/logger.ts` (pino): a stable message plus fields, never a DTO, an entity or a body.
- Health checks and metrics routes are not wrapped (the request log skips them) and touch no tenant entity.
