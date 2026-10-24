# Strategy

Interchangeable algorithms or behaviors behind one contract, chosen by context. With a registry keyed by a code, it replaces `if/else` chains on a type.

## Signals

- An `if/else` or `switch` on a provider code, type or channel that grows with every new case.
- The same call site needs different behavior per tenant, country or payment method.
- Tests need to swap one algorithm without touching the rest.

## Use when

- There are at least two real behaviors behind the same contract. Default: refactor at the third `if` branch (rule of three).
- Provider integrations are the exception: the registry exists from the second provider, or from the first when the profile records that more are expected. With exactly one provider expected, inject the port directly. See `stackcrew-spring-integration-provider`, step 0.
- The caller should not know which behavior runs.
- Adding a case should mean adding one unit, not editing a central switch (OCP).

## Do not use when

- One behavior exists and no second one is planned.
- The branches are two trivial lines; a plain `if` is clearer.
- The variants share a fixed skeleton with a few different steps; use [Template Method](template-method.md) (the two combine: strategies often extend a template).
- An enum with a `switch` over a closed, stable set is enough and the compiler checks exhaustiveness (a union type in TypeScript).

## Idioms

### Java (Spring Boot / Quarkus)

- The provider-registry approach from `stackcrew-spring-integration-provider`: every strategy implements a port (`ProviderPort` with a `code()` method) and is a bean; the registry injects `List<ProviderPort>` and builds a map keyed by `code()`.
- Do not inject `Map<String, ProviderPort>` and treat its keys as provider codes: Spring keys an injected map by bean name (`c06Adapter`), not by `code()`.
- A duplicate code must fail at startup (`Collectors.toUnmodifiableMap` throws), and an unknown code throws a typed exception.
- For a small closed set on Java 17, use an `enum` with a `switch` expression (exhaustive, compiler-checked). Java 21+ only, optional: a `sealed interface` with a pattern-matching `switch` (JEP 441). On Java 17 a sealed type needs an `instanceof` chain, which is noisier than the enum.
- Quarkus: `Instance<Port>` or `@All List<Port>` plays the same role as the injected list.
- A lambda or `Function` is a strategy when there is no state and no name worth giving.

### TypeScript (NestJS / Next.js / React / Angular)

- A stateless strategy is a map of functions: `const handlers: Record<Kind, (input: Input) => Output>`. No class needed.
- Key the map with a union type or an `as const` object so a missing case is a compile error.
- NestJS 10 has no multi-provider option (unlike Angular). To collect several strategies, register each one as a provider and add a factory provider: `{ provide: STRATEGIES, useFactory: (a: A, b: B) => [a, b], inject: [A, B] }`, or discover them with `DiscoveryService` and a marker decorator. Then build a registry that maps `code` to the strategy and fails on a duplicate.
- React and Angular: pass the strategy as a prop, hook argument or injection token, not through `if` branches in the template.

### Go

- A function type is the strategy: `type Pricer func(ctx context.Context, in Order) (Money, error)`. A `map[Kind]Pricer` is the registry.
- Use a small interface (one method) when the strategy has state or dependencies. Define it at the consumer.
- Build the registry in a constructor, return an error on a duplicate key, and return a typed error for an unknown key.

## Example

Language: TypeScript. A registry of typed functions replaces a switch.

```typescript
export const FeeKind = { Flat: 'flat', Percent: 'percent' } as const;
export type FeeKind = (typeof FeeKind)[keyof typeof FeeKind];

const BPS_PER_UNIT = 10_000;

export interface FeeInput { amountMinor: number; flatMinor: number; rateBps: number }

const calculators: Record<FeeKind, (input: FeeInput) => number> = {
  [FeeKind.Flat]: (input) => input.flatMinor,
  [FeeKind.Percent]: (input) => Math.round((input.amountMinor * input.rateBps) / BPS_PER_UNIT),
};

export function calculateFee(kind: FeeKind, input: FeeInput): number {
  return calculators[kind](input);
}
```

## AI anti-patterns

- A strategy interface with one implementation and no second one planned.
- A class per strategy in TypeScript or Go when a function would do.
- Keeping the `if (code.equals(...))` chain and adding a registry next to it.
- Injecting `Map<String, Port>` in Spring and assuming the keys are provider codes.
- Using an Angular-style multi-provider option in NestJS, or a Java 21 pattern `switch` in a Java 17 project.
- A registry that returns `null` for an unknown key instead of a typed error.
- Strategies that reach back into the caller's state, so they are not truly interchangeable.
