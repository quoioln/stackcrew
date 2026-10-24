# Builder

Construct a complex, usually immutable object step by step or by named options.

## Signals

- A constructor or function with many parameters, especially several optional ones or several of the same type.
- Call sites that pass `null`, `undefined` or empty values to skip optional parameters.
- A test fixture that repeats a long object setup in every test.

## Use when

- There are many optional fields and the result must be immutable.
- Construction has rules that belong in one place (defaults, validation, derived fields).
- Test data needs a readable default object with small overrides.

## Do not use when

- Few fields or all required: use a `record` (Java), an object literal with a type (TypeScript), a plain struct (Go).
- The class is a JPA entity: never put Lombok `@Builder` (or `@Data`) on an entity. Use a constructor or a static factory that enforces invariants.
- A static factory method with a clear name says it better (`Money.of(amount, currency)`).
- The "builder" would only wrap setters on a mutable object.

## Idioms

### Java (Spring Boot / Quarkus)

- Few fields: a plain `record` with a compact constructor for validation.
- Many optional fields: a `record` plus a small hand-written builder (default). Lombok `@Builder` only when a record does not fit: inheritance, or 8+ optional fields. On a Lombok class use `@Value` for immutability, `@Builder.Default` for defaults (it applies to classes, not record components) and `@Singular` for collections.
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

Language: Java. A record with a small hand-written builder: immutable, defaults in one place, no Lombok needed.

```java
public record ReportRequest(String title, LocalDate from, LocalDate to, Locale locale,
                            String department, Integer pageSize) {

    public ReportRequest {
        Objects.requireNonNull(title, "title");
        Objects.requireNonNull(from, "from");
        Objects.requireNonNull(to, "to");
    }

    public static Builder builder(String title, LocalDate from, LocalDate to) {
        return new Builder(title, from, to);
    }

    public static final class Builder {
        private final String title;
        private final LocalDate from;
        private final LocalDate to;
        private Locale locale = Locale.ENGLISH;
        private String department;
        private Integer pageSize;

        private Builder(String title, LocalDate from, LocalDate to) {
            this.title = title; this.from = from; this.to = to;
        }

        public Builder locale(Locale value) { this.locale = value; return this; }
        public Builder department(String value) { this.department = value; return this; }
        public Builder pageSize(Integer value) { this.pageSize = value; return this; }

        public ReportRequest build() {
            return new ReportRequest(title, from, to, locale, department, pageSize);
        }
    }
}
```

With 8 or more optional fields, or when the type needs inheritance, replace the hand-written builder with Lombok `@Value @Builder` on a class.

## AI anti-patterns

- Lombok `@Builder` or `@Data` on a JPA entity.
- Lombok `@Builder` on a type with a few fields where a record is enough.
- A builder for a record with three required fields.
- A hand-written fluent builder class in TypeScript or a `Builder` type in Go where options or a literal work.
- A builder that exposes setters on a mutable object, so the result is not immutable.
- Building an object with `Map<String, Object>` or `any` options instead of typed fields.
- Skipping the builder when the signal is clear: a nine-argument constructor with many nulls.
