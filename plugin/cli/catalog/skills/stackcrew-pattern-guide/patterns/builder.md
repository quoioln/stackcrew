# Builder

Construct a complex, usually immutable object step by step or by named options.

## Signals

- A constructor or function with many parameters, especially several optional ones or several of the same type.
- Call sites that pass `null`, `undefined` or empty values to skip optional parameters.
- A test fixture that repeats a long object setup in every test.

## Use when

- There are many optional fields (roughly five or more optional ones) and the result must be immutable.
- Construction has rules that belong in one place (defaults, validation, derived fields).
- Test data needs a readable default object with small overrides.

## Do not use when

- Few fields (about four or fewer) or all required: use a `record` (Java), an object literal with a type (TypeScript), a plain struct (Go).
- The class is a JPA entity: never put Lombok `@Builder` (or `@Data`) on an entity. Use a constructor or a static factory that enforces invariants.
- A static factory method with a clear name says it better (`Money.of(amount, currency)`).
- The "builder" would only wrap setters on a mutable object.

## Idioms

### Java (Spring Boot / Quarkus)

- Few fields: a `record`. Optional values with defaults: a compact constructor or a static factory.
- Many optional fields: Lombok `@Builder` on an immutable value class (`@Value`), or on a large record when it needs one (`@Builder.Default` is for classes, not record components). Add `@Builder.Default` for defaults and `@Singular` for collections; required fields are validated in the constructor or with bean validation.
- Never on JPA entities. Never `@Data` on an entity.
- Test data builders are fine in test code; keep them in the test source set.

### TypeScript (NestJS / Next.js / React / Angular)

- A typed object literal is the builder: `createReport({ title, from, to })` with an options interface, defaults applied in the function.
- Validate and default with a zod schema (`schema.parse(input)`); the inferred type is the result type, so no class is needed.
- Use `Readonly<T>` or `as const` for immutability. A fluent builder class is rarely worth it.

### Go

- Functional options: `func NewClient(baseURL string, opts ...Option) (*Client, error)` with `type Option func(*config)`. Required values are plain parameters; optional ones are options.
- A plain struct literal with named fields is enough when the zero values are valid defaults.
- Validate in the constructor and return an error; do not expose a half-built value.

## Example

Language: Java. A record for few fields, and Lombok `@Builder` only for a class with many optional fields.

```java
// Few fields: a record is enough.
public record VerifyCommand(String referenceId, String documentNumber, Instant requestedAt) {}

// Many optional fields: Lombok @Builder on a value class (never on a JPA entity).
@Value
@Builder
public class ReportRequest {
    @NonNull String title;
    @NonNull LocalDate from;
    @NonNull LocalDate to;
    @Builder.Default Locale locale = Locale.ENGLISH;
    String department;
    String costCenter;
    boolean includeDrafts;
    Integer pageSize;
    String sortField;
}
```

## AI anti-patterns

- Lombok `@Builder` or `@Data` on a JPA entity.
- A builder for a record with three required fields.
- A hand-written fluent builder class in TypeScript or a `Builder` type in Go where options or a literal work.
- A builder that exposes setters on a mutable object, so the result is not immutable.
- Building an object with `Map<String, Object>` or `any` options instead of typed fields.
- Skipping the builder when the signal is clear: a nine-argument constructor with many nulls.
