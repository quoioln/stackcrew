---
id: lang-typescript
title: TypeScript
---
# TypeScript

TypeScript 5+ in `strict` mode. Applies to every `.ts` and `.tsx` file, whatever the framework. Framework rules live in the stack rule.

## Essentials

- `strict: true` in `tsconfig.json`; never loosen it per file. No `@ts-ignore` and no `@ts-nocheck` (SC-IGNORE); `@ts-expect-error` is allowed with a reason on the same line.
- No `any` in any form (SC-TYPE): not `: any`, `as any`, `any[]`, `Promise<any>` or `Record<string, any>`. Do not use `object`, `{}` or `Function` as types either.
- External data (request bodies, env, API responses, queue messages, `JSON.parse`) enters as `unknown` and is parsed at the edge with zod or class-validator. Past the edge the value has a real type.
- `process.env` is read only in the config/env module (SC-ENV). Everything else receives the typed value.
- No magic strings or numbers (SC-CONST): a named constant, an `enum` or an `as const` object. A URL comes from config, never a literal.
- Shared `interface` and `type` declarations live in their own files (`*.types.ts`, `dto/`, `interfaces/`, `schemas/`), never inside a service, action or component file.
- Search the existing helpers, components and types first, including {{sc:sharedLibraries}}, before writing a new one.
- Derive types from one source of truth: `z.infer<typeof schema>`, `typeof CONST[keyof typeof CONST]`, `Pick`/`Omit`. Do not hand-copy a shape.
- Prefer `readonly` and immutable data. Return a new object instead of mutating an argument.
- Never swallow an error: catch `unknown`, narrow it, and rethrow with context. No empty `catch`.
- Waive a guard rule on the same line with `stackcrew-allow: SC-XXX <reason>`.

## SC-TYPE: wrong and right

Wrong, an untyped payload travels through the code:

```ts
const body: any = await res.json();
const total = (body as any).items.length;
function parse(input: object): Record<string, any> { ... }
```

Right, `unknown` at the edge, parsed once into a real type:

```ts
const VerifyResponse = z.object({ status: z.enum(['APPROVED', 'REJECTED']), verifiedAt: z.coerce.date() });
type VerifyResponse = z.infer<typeof VerifyResponse>;

const result: VerifyResponse = VerifyResponse.parse(await res.json());
```

With class-validator the DTO class plays the same role as the zod schema. Use `Record<string, KnownType>` when every value has one type, and `unknown` when you truly do not know yet. A library signature that forces `any` is the only exception: `stackcrew-allow: SC-TYPE <reason>` on that line.

## Suppressions: wrong and right

Wrong:

```ts
// @ts-ignore
const user = repo.find(id);
```

Right, fix the type; if a one-line suppression is unavoidable, say why:

```ts
// @ts-expect-error vendor typing misses the "retry" option (issue linked in the PR)
client.configure({ retry: 3 });
```

## Environment access: wrong and right

Wrong:

```ts
const timeout = Number(process.env.TIMEOUT_MS ?? 3000);
```

Right, one module validates the environment; the rest import the typed value:

```ts
// src/config/env.ts
export const env = z.object({ TIMEOUT_MS: z.coerce.number().default(3000) }).parse(process.env);

// elsewhere
import { env } from '../config/env';
const timeout = env.TIMEOUT_MS;
```

## SC-CONST: wrong and right

Wrong:

```ts
if (order.status === 'PAID') { ... }
await fetch('https://api.example.com/v1/verify', { headers: { 'x-request-id': id } });
setTimeout(retry, 5000);
```

Right:

```ts
export const OrderStatus = { PAID: 'PAID', PENDING: 'PENDING' } as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

const RETRY_DELAY_MS = 5_000;
await fetch(`${env.VERIFY_API_URL}/verify`, { headers: { [REQUEST_ID_HEADER]: id } });
```

- A status is an `as const` object or `enum`; a header or key is a constant in a domain constants file; a URL or timeout is configuration.
- Group constants by domain (`kyc.constants.ts`), not in one global dump.
- `-1`, `0`, `1`, array indexes, default values and numeric literal types are fine. So are numbers and strings inside tests.

## Types in their own files: wrong and right

Wrong, a shared type declared in the service that happens to use it:

```ts
// order.service.ts
export interface CreateOrderInput { sku: string; quantity: number }
export class OrderService { ... }
```

Right, the type has its own file and everyone imports it from there:

```ts
// dto/create-order.dto.ts  (or order.types.ts, interfaces/, schemas/)
export interface CreateOrderInput { sku: string; quantity: number }
```

A type used by one file only may stay private in that file (not exported).

## Search before you write: wrong and right

Wrong, a new date formatter next to the three that exist:

```ts
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
```

Right: grep the verb (`format`, `mask`, `retry`, `parse`) in `common`, `shared`, `utils`, `lib` and {{sc:sharedLibraries}}; reuse or extend what exists, and put a new helper where the next reader will look.

## Style

- Prefer `type` unions and `as const` over `enum` for new code; use `enum` only where the codebase already does.
- Narrow with type guards and discriminated unions, not casts. `as` is allowed only to a type you have just proven.
- Use `async`/`await`; never leave a promise floating (await it or `void` it on purpose).
- Format with Prettier and lint with the stackcrew ESLint config; do not commit formatting-only noise mixed with logic.
