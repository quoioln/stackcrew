---
name: stackcrew-next-server-action
description: Use when adding or changing a form and its server action in a Next.js app, such as an eKYC registration form for a signed-in user: the zod schema in its own file with z.infer types, the action wrapped with withActionLogging that checks the caller and role through getRequestContext, a typed result with a DTO, react-hook-form with zodResolver on the shared UI components, pending, success and error states, and the tests.
kind: task
---
# Add a form and its server action (Next.js 16)

Follow these steps in order. Write the SC-PREFLIGHT note first: the feature folder, its schemas, DTOs, mappers, messages and components that already exist; the form components in `{{sc:sharedComponents}}` (button, input, label, select, form field); whether the entity exists (`stackcrew-next-typeorm-entity`); and the action result, logging wrapper and request context from `stackcrew-next-request-logging`. Reuse what exists; never add a second schema, result type or form component for the same thing.

The example is the eKYC registration of a signed-in user: the applicant enters their full name, date of birth, document type and number; the action stores one registration per applicant and tenant, and answers with a DTO. Set up the request logging skill (wrappers, `getRequestContext()`, `ActionResult`) and the entity skill (base classes, `TenantScopedRepository`, `getDataSource()`) first.

## 1. Files

Each `<file>.md` next to this skill holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `kyc-registration.constants.ts.md` | Document types, statuses, roles, lengths and paths as `as const` objects; imports nothing, so the browser can load it. |
| `kyc-registration.messages.ts.md` | The form's text catalog: labels, the schema's messages, one text per refusal code. |
| `register-kyc.schema.ts.md` | `registerKycSchema` and `RegisterKycInput = z.infer<...>`: the one schema of the form and the action. |
| `kyc-registration.entity.ts.md`, `create-kyc-registration.migration.ts.md` | The tenant entity with a named unique constraint on (tenant, applicant), and its migration. |
| `kyc-registration.repository.ts.md` | `KycRegistrationRepository` on `TenantScopedRepository`: `insertUnlessRegistered` turns the unique violation into `null`. |
| `kyc-registration.dto.ts.md`, `kyc-registration.mapper.ts.md` | The result DTO (id, document type, status, time; no identity data) and its mapper. |
| `kyc-registration.service.ts.md` | `submitKycRegistration(input)`: the caller, the role, the schema, the insert, the DTO. Shared by the action and the route handler. |
| `actions.ts.md` | `'use server'`: `registerKyc`, wrapped with `withActionLogging`; revalidates the reviewers' page. |
| `kyc-registration-form.tsx.md` | The client form: react-hook-form, `zodResolver`, the shared components, every state. |
| `page.tsx.md` | `src/app/kyc/page.tsx`: the Server Component around the form; a visitor without a session goes to sign in. |
| `register-kyc.schema.spec.ts.md`, `actions.spec.ts.md`, `kyc-registration-form.spec.tsx.md` | Unit tests (section 8). |
| `kyc-registration.int.spec.ts.md`, `kyc-registration.spec.ts.md` | The action on Postgres; the Playwright test (`e2e/`). |

Register the entity and its migration (the TypeORM CLI generates the migration; read it before you keep it):

```ts
// src/shared/db/data-source.options.ts (add)
import { KycRegistration } from '../../features/kyc-registrations/kyc-registration.entity';
import { CreateKycRegistration1730000000001 } from './migrations/1730000000001-create-kyc-registration';

export const ENTITIES = [CustomerProfile, KycRegistration];
export const MIGRATIONS = [CreateCustomerProfile1730000000000, CreateKycRegistration1730000000001];
```

Copy `customer-profile.persistence.int.spec.ts` of the entity skill for the new entity's audit and tenant tests.

## 2. Dependencies (ask the user before adding any)

`react-hook-form` 7, `@hookform/resolvers` 5 and `zod` 3 for the form; the shared components of `{{sc:sharedComponents}}` (shadcn: `button`, `input`, `label`, `native-select`). A missing component is added with the project's own generator (`npx shadcn@latest add native-select`), never written by hand. In the code, imports use the project's alias for `{{sc:sharedComponents}}` (shadcn `components.json` → `aliases.ui`; `cn` at `aliases.utils`); the examples assume `@/components/ui` and `@/lib/utils`. Testing Library and Playwright for the tests (stack testing rule).

## 3. The schema

- One schema per form, in `schemas/<action>.schema.ts`, with its type next to it: `export type RegisterKycInput = z.infer<typeof registerKycSchema>;`. Never write the type by hand, and never declare it in `actions.ts` (SC-TYPEFILE).
- The browser runs the schema too, so it imports only constants and text. Never the entity: `kyc-registration.entity.ts` pulls TypeORM into the client bundle. Keep the constants the entity and the schema share in `<feature>.constants.ts`.
- Lengths come from the same constants as the columns. Unknown keys are stripped, so a client cannot send `applicantId`, `{{sc:tenantColumn}}`, `status` or an audit field.
- Every message is constant text from the catalog. zod 3's default enum message quotes the received value; give enums an `errorMap`. The message travels to the browser, into the action's log line and into a route handler's problem body.
- Keep input and output types equal (no `.default()`, no `.transform()` to another type), so `useForm<RegisterKycInput>` matches what `zodResolver` produces. A schema that converts types uses `useForm<z.input<typeof s>, unknown, z.output<typeof s>>`.

## 4. The action and the shared function

```ts
// in actions.ts: the export name, wrapped; the body is the shared function plus the Next.js cache
export const registerKyc = withActionLogging('registerKyc', async (input: unknown): Promise<ActionResult<KycRegistrationDto>> => {
  const result = await submitKycRegistration(input);
  if (result.ok) {
    revalidatePath(KycPath.REGISTRATIONS);
  }
  return result;
});
```

- `submitKycRegistration` checks, in order: signed in (`getRequestContext()`, which calls `auth()`; `userId` undefined → `UNAUTHENTICATED`), allowed (a tenant and the applicant role → otherwise `FORBIDDEN`, before any repository call, which would throw `MissingTenantError` and become a 500), valid (`safeParse` → `VALIDATION` with `parsed.error.flatten().fieldErrors`). Then it writes and returns `ok(toKycRegistrationDto(saved))`. Feature code never calls `auth()` itself.
- The applicant is `caller.userId`, never a form field. The tenant comes from the context too; the subscribers write it and the audit fields.
- Every exported action is a public POST endpoint, callable without the page: the checks live in the action's own code path, whatever the page checked.
- The function is shared with `POST /api/v1/kyc-registrations` (`stackcrew-next-route-handler`). Wrap only the exports: a wrapped action that calls another wrapped action writes two log lines.
- Refusals are typed results (`fail(code)`); only an unexpected failure throws. The wrapper logs the call once (the identity fields masked as `"***"`), and a throw also reaches `onRequestError`.
- A repeat is decided by the database: the unique constraint and `insertUnlessRegistered` answer `CONFLICT`, also for two concurrent submits. A read before the insert does not stop the second one. The constraint covers every status, so a rejected applicant cannot apply again; to allow that, make it a partial unique index (`CREATE UNIQUE INDEX "kyc_registration_applicant_key" ON "kyc_registration" ("{{sc:tenantColumn}}", "applicantId") WHERE "status" IN ('PENDING', 'VERIFIED')`, `@Index(..., { unique: true, where })` on the entity) and keep the refusal text neutral.
- After a write: `revalidatePath(path)` of the pages that show it, or `revalidateTag(tag, 'max')`; `updateTag(tag)` when this user must read their own write at once.
- The result is a DTO of plain strings: no entity, no `Date`, and no echo of the identity data just sent.
- Scope: this action stores the registration. Calling the eKYC provider, uploading document images, the provider idempotency key and outcome side writes are not part of it: the verification runs later as a stored operation, outside this request (the cross-stack "Outbound idempotency" and "Outcome side-write seam" decisions). Never call a provider inside the action's transaction.
- Field names decide masking: `fullName`, `dateOfBirth` and `idNumber` are on the masker's PII list, `documentType` is not (and is not PII). A PII field under another name (`documentNumber`) would be logged in clear: rename it, or set `LOG_MASK_FIELDS` to the full default list plus the name.

## 5. The form

- A Client Component (`'use client'`) at the leaf; the page around it stays a Server Component.
- `useForm<RegisterKycInput>({ resolver: zodResolver(registerKycSchema), defaultValues })`, the action called in `handleSubmit` with the parsed values. Not `useActionState`: the action takes one `unknown` argument, not `(previousState, formData)`, and react-hook-form already holds the state.
- Pending: `formState.isSubmitting` is true while the action runs; disable the button and change its text. `aria-busy` on the form.
- Success: the confirmation (`role="status"`) replaces the form and takes the focus (`tabIndex={-1}`), so keyboard and screen-reader users land on it.
- Refusal: `result.error.fieldErrors` goes back onto the fields with `setError(field, { message })`, and the refusal text of the code onto `root.server`, shown with `role="alert"`.
- Unexpected failure: an awaited action that throws rejects inside the submit handler; it never reaches `error.tsx`. Catch it there and show constant text, never `error.message`. The server already logged it with its digest.
- Accessibility: each control has a `Label` with `htmlFor`, `aria-invalid` and `aria-describedby` pointing at its error; errors are text, not color alone.
- Controls come from `{{sc:sharedComponents}}`; the alias rule of section 2 applies to their imports and to `cn`. With shadcn's `Field` components or a `Form` wrapper in the project, use those for the field layout. Classes through `cn()`, Tailwind tokens only, no `style`.
- Text comes from the feature's catalog (`kyc-registration.messages.ts`); with an i18n library in the project, from its catalog.

## 6. The page

`src/app/kyc/page.tsx` renders the heading and the form. It loads no data, so it needs no `loading.tsx` or empty state; a page that does follows `stackcrew-next-feature-page`. It reads the caller through `getRequestContext()` and sends a visitor without a session to sign in with `redirect()`, outside any `try`.

## 7. Safety

- Never trust the client: role, tenant and ownership are checked in the action; the schema runs again on the server.
- A server action has Next.js's own body limit (`experimental.serverActions.bodySizeLimit` in `next.config.ts`, 1 MB by default). Files go to object storage through an upload route, never through the action.
- Never log in the action or the form: the wrapper writes the one masked line. Never put input in an error message.

## 8. Tests

`stackcrew-nextjs-testing` is the full procedure. For this feature:

- `register-kyc.schema.spec.ts`: valid input, trimmed; stripped server-owned keys; each field's refusals; an unknown enum value not quoted back.
- `actions.spec.ts`: the wrapped action with only `next/headers`, `auth()`, `next/cache` and the repository mocked: the DTO and the stored applicant; one `http_in` line with `"idNumber":"***"`; `UNAUTHENTICATED`, `FORBIDDEN` (no role, no tenant) before the repository; `VALIDATION`; `CONFLICT`; a thrown error rethrown and logged once as 500 without its message.
- `kyc-registration-form.spec.tsx` (jsdom): schema errors without calling the action; pending (button disabled), then the confirmation; server field errors and the refusal; constant text when the action throws.
- `kyc-registration.int.spec.ts` (Postgres): stored in the caller's tenant with the audit fields; a second registration answers `CONFLICT`; of two concurrent submits exactly one passes; the same user registers once per tenant.
- `e2e/kyc-registration.spec.ts` (Playwright): a signed-in applicant fills the form and sees the confirmation (a CI retry, which meets the first attempt's registration, accepts the `CONFLICT` text); a visitor without a session is sent to sign in.

## Do not

- Do not declare types in `actions.ts`, export anything from it but wrapped actions, or call `auth()` in feature code.
- Do not take the user, the tenant, a status or an audit field from the form.
- Do not import the entity, a repository or a `'server-only'` module into the schema or a client component.
- Do not return an entity or echo identity data in the result, and do not show `error.message` to the user.
- Do not write a second button, input, select or form field when `{{sc:sharedComponents}}` has one, and do not use `style`.
- Do not decide a duplicate with a read before the insert; let the unique constraint decide.
