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

- Provider DTOs are package-private `record`s next to the adapter, with boxed types for fields that may be absent. A dedicated mapper (a small class, or MapStruct) converts to domain records and `enum`s. Unknown provider statuses throw a typed `ProviderProtocolException`; never fall through.
- Be null-safe: check the reply and its fields before mapping, so a malformed response becomes a typed error and not an NPE. A `Map` lookup from provider code to domain enum is simpler than a `switch` on a possibly-null string.
- Domain code imports nothing from the provider package; enforce it with an ArchUnit rule when wired.
- Provider error codes and HTTP statuses become domain exception types (`ProviderUnavailableException`, `ProviderRejectedException`, `ProviderProtocolException`).

### TypeScript (NestJS / Next.js / React / Angular)

- A zod schema parses the raw response (the boundary where untyped data is first handled); a pure `toDomain` function returns a domain type. Use a discriminated union for status instead of strings passed around.
- Keep the provider schema and mapper in the adapter module; export only domain types from its `index.ts`.
- Frontend: map the API response to a view model once, in the data layer, not in components.

### Go

- Provider structs (with `json` tags) are unexported in the provider package. An unexported `toDomain` function converts to the domain struct. The domain package never imports the provider package.
- Map provider errors to sentinel or typed errors (`errors.Is` / `errors.As`) in the same place.
- Unknown enum values map to an explicit constant or an error, not a silent zero value.

## Example

Language: Java. The mapper is the only class that knows both vocabularies (the playbook's C06 types). A malformed reply is a typed error, not an NPE.

```java
final class C06Mapper {
    private static final Map<String, VerificationStatus> STATUS = Map.of(
        C06Codes.OK, VerificationStatus.APPROVED,
        C06Codes.NOT_MATCH, VerificationStatus.REJECTED,
        C06Codes.PROCESSING, VerificationStatus.PENDING);

    VerifyResult toDomain(C06VerifyResponse r) {
        if (r == null || r.resultCode() == null || r.matchScore() == null) {
            throw new ProviderProtocolException(ProviderCodes.C06, "missing result code or score", null);
        }
        VerificationStatus status = STATUS.get(r.resultCode());
        if (status == null) {
            throw new ProviderProtocolException(ProviderCodes.C06, "unknown result code", null);
        }
        return new VerifyResult(status, r.matchScore(), r.transactionId());
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
record C06VerifyResponse(String resultCode, BigDecimal matchScore, String transactionId) {}
```

## AI anti-patterns

- Returning the provider DTO from the port, or storing provider status strings in the domain.
- Mapping inline inside controllers or entities, in several places.
- Silently defaulting an unknown provider status to "success" or to the zero value.
- A `switch` on a provider string that may be null, so a malformed reply throws an NPE.
- Using `Map<String, Object>`, `JsonNode`, `any` or `interface{}` as the domain's idea of a provider payload.
- Sharing one DTO class between the provider call and your public API response.
- Adding the ACL only for provider two, after provider one has already leaked into the domain.
