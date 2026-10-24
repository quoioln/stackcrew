---
id: lang-java
title: Java
---
# Java

Java 17+ (LTS). Applies to every `.java` file. The Spring-specific rules live in the Spring Boot rule.

## Essentials

- SC-TYPE: no `JsonNode`, `ObjectNode`, `Map<String, Object>`, `Map<?, ?>` or `Object` as a DTO or method signature. Define a `record` and map the payload at the boundary.
- SC-CONST: no magic strings or numbers (URLs, header names, status codes, keys, timeouts, limits, roles). Use a `static final` constant, an `enum` or `@ConfigurationProperties`; search for an existing constant first.
- SC-REUSE: search the codebase for an existing util or service before writing logic; extract repeated logic into one shared method with one abstraction level.
- DTOs and value objects are `record`s. Lombok `@Builder` only on a class with many optional fields (or a large record that needs a builder); never Lombok or `@Data` on a JPA entity.
- Use `jakarta.*` (never `javax.*`) and Java 17 features: `record`, `sealed` types, `switch` expressions, text blocks.
- Return `Optional` for an absent result; never use `Optional` for fields or parameters. Annotate nullability where the project has adopted it.
- Never swallow an exception: wrap with context and keep the cause; no control flow through exceptions.
- Time is `java.time` (UTC `Instant`, an injected `Clock`); money is `BigDecimal` or integer minor units.
- Immutable by default: `final` fields, no setters on value objects, `List.copyOf` for stored collections.
- Close every `Closeable` with try-with-resources.

## SC-TYPE: wrong and right

Wrong, an untyped payload travels through the code:

```java
Map<String, Object> result = restClient.get().uri(url).retrieve().body(Map.class);
String status = (String) result.get("status");
JsonNode data = mapper.readTree(json);
```

Right, a record at the boundary, validated once:

```java
public record VerifyResponse(@NotBlank String status, @NotNull Instant verifiedAt) {}

VerifyResponse result = restClient.get().uri(url).retrieve().body(VerifyResponse.class);
```

A value that is a bag of one known type is fine: `Map<String, KycResult>`.

The only exception is the spot where a truly dynamic payload is first deserialized. Map it to a record on the next line and mark it: `stackcrew-allow: SC-TYPE <reason>`.

## SC-CONST: wrong and right

Wrong:

```java
if (response.status().equals("APPROVED")) { ... }
restClient.get().uri("https://api.example.com/v1/verify").header("X-Request-Id", id);
Thread.sleep(3000);
```

Right:

```java
public enum VerificationStatus { APPROVED, REJECTED, PENDING }

public final class KycHeaders {
    private KycHeaders() {}
    public static final String REQUEST_ID = "X-Request-Id";
}
```

- A status is an `enum`; a header or key is a constant in a domain constants class; a URL or timeout is a property in `@ConfigurationProperties`.
- Group constants by domain (`KycHeaders`, `ProviderCodes`), not in one global `Constants` dump.
- Obvious `0` and `1` and message text inside tests are fine.

## SC-REUSE: wrong and right

Wrong, the same masking and mapping logic pasted into three adapters:

```java
String masked = id.substring(0, 3) + "****" + id.substring(id.length() - 2);
```

Right, one shared method that every caller uses:

```java
public final class Masking {
    private Masking() {}
    public static String maskId(String id) { ... }
}
```

Before creating a helper, grep for the verb (`mask`, `retry`, `toBasicAuth`, `parseDate`) in `common`, `util` and `support` packages and the module you are editing.

## Records, Builder and Lombok

- Few fields: a plain `record` with a compact constructor for validation.
- Many optional fields: a `record` plus a small hand-written builder, or a Lombok `@Builder` class when a record does not fit (inheritance, 8+ optional fields).
- Entities: plain JPA classes with explicit constructors and `equals`/`hashCode` on the business key or id. No `@Data`, no `@Builder`, no `@AllArgsConstructor`.
- `@Slf4j`, `@RequiredArgsConstructor` are acceptable on services; prefer a visible constructor when a class has more than three dependencies, since that is a design smell worth seeing.

## Null-safety and exceptions

- A method that can find nothing returns `Optional<T>`; a method that must find something throws a specific, named exception.
- Custom exceptions extend a project base exception, carry an error code constant and a message with context, and never carry secrets or PII.
- `catch (Exception e)` is only allowed at a boundary (controller advice, message listener, scheduler) that logs and translates it.
- `Objects.requireNonNull(value, "name")` in constructors of value objects.

## Streams and concurrency

- Streams transform data; they do not carry side effects. A plain loop is fine when it is clearer or on a hot path.
- Prefer `java.util.concurrent` and immutable shared state over `synchronized`. Never block inside a reactive or async context.
- Virtual threads (Java 21) are fine for blocking I/O; do not pool them and do not pin them with `synchronized` around I/O.

## Build and static analysis

- Maven or Gradle with locked dependency versions; no version ranges.
- Compile with `-Xlint:all -Werror` for production code; Checkstyle, SpotBugs, PMD or Error Prone in CI.
- Format with Spotless (google-java-format); never commit formatting-only noise mixed with logic.
- Tests: JUnit 5 and AssertJ; Mockito for collaborators only; Testcontainers for integration. See the Spring Boot testing rule.
