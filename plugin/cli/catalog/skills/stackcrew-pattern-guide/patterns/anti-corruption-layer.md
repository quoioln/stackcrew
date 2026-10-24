# Anti-Corruption Layer (ACL)

A translation boundary so that a foreign model (third-party, legacy) never shapes the domain model. It is the core of any integration.

## Signals

- A provider's field names, status codes, enums or error format appear in domain classes, database columns or API responses.
- Adding a provider forces changes in domain code.
- Mapping code is scattered across services, controllers and entities.

## Use when

- A third-party model differs from the internal model (names, units, status vocabulary, nullability, error semantics).
- You integrate with a legacy system whose model you do not want to inherit.
- Several providers must look identical to the domain.

## Do not use when

- The external model is the same concept as the internal one, you own both, and they change together (an internal service in the same bounded context).
- A pass-through proxy that deliberately forwards the upstream shape unchanged.
- The mapping would be a one-to-one copy of every field with no isolation value for a short-lived script.

## Idioms

### Java (Spring Boot / Quarkus)

- Provider DTOs are package-private `record`s next to the adapter. A dedicated mapper (a small class or static methods, or MapStruct) converts to domain records and `enum`s. Unknown provider statuses map to an explicit `UNKNOWN` or throw a typed exception; never fall through.
- Domain code imports nothing from the provider package; enforce it with an ArchUnit rule when wired.
- Provider error codes become domain exception types in the mapper.

### TypeScript (NestJS / Next.js / React / Angular)

- A zod schema parses the raw response (the boundary where untyped data is first handled); a pure `toDomain` function returns a domain type. Use a discriminated union for status instead of strings passed around.
- Keep the provider schema and mapper in the adapter module; export only domain types from its `index.ts`.
- Frontend: map the API response to a view model once, in the data layer, not in components.

### Go

- Provider structs (with `json` tags) are unexported in the provider package. An unexported `toDomain` function converts to the domain struct. The domain package never imports the provider package.
- Map provider errors to sentinel or typed errors (`errors.Is` / `errors.As`) in the same place.
- Unknown enum values map to an explicit constant, not a silent zero value.

## Example

Language: Java. The mapper is the only place that knows both models.

```java
final class C06Mapper {
    private C06Mapper() {}

    static VerifyResult toResult(C06Response response) {
        return new VerifyResult(toStatus(response.state()), response.ref());
    }

    private static VerifyStatus toStatus(String state) {
        return switch (state) {
            case C06Codes.STATE_OK -> VerifyStatus.APPROVED;
            case C06Codes.STATE_REJECTED -> VerifyStatus.REJECTED;
            default -> throw new ProviderProtocolException(C06Codes.PROVIDER, "unknown state: " + state);
        };
    }
}

record C06Response(String state, String ref) {}
```

## AI anti-patterns

- Returning the provider DTO from the port, or storing provider status strings in the domain.
- Mapping inline inside controllers or entities, in several places.
- Silently defaulting an unknown provider status to "success" or to the zero value.
- Using `Map<String, Object>`, `JsonNode`, `any` or `interface{}` as the domain's idea of a provider payload.
- Sharing one DTO class between the provider call and your public API response.
- Adding the ACL only for provider two, after provider one has already leaked into the domain.
