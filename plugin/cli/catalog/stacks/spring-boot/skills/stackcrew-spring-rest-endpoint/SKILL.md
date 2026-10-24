---
name: stackcrew-spring-rest-endpoint
description: Use when adding or changing a REST endpoint in a Spring Boot service: controller, request and response DTO records, Bean Validation, ProblemDetail errors, service layering and pagination.
kind: task
paths: ["**/*.java"]
---
# Add a REST endpoint (Spring Boot 3)

Write the SC-PREFLIGHT note first: which controller, service and DTOs exist, which constants and error types you will reuse.

## 1. Request and response records

DTOs are records in the API package, separate from entities and from provider models.

```java
public record CreateVerificationRequest(
    @NotBlank @Size(max = 32) String documentNumber,
    @NotNull VerificationChannel channel) {}

public record VerificationResponse(UUID id, VerificationStatus status, Instant createdAt) {
    public static VerificationResponse from(Verification v) { return new VerificationResponse(v.id(), v.status(), v.createdAt()); }
}
```

`Verification` is the domain result record the service returns; the response record is an API type that only the controller creates.

- `jakarta.validation.constraints.*` only. Put constraints on the record components.
- Statuses and channels are enums; never raw strings.
- No `Map<String, Object>`, `JsonNode` or entity in a request or response.

## 2. Controller: map, delegate, map

```java
@RestController
@RequestMapping(ApiPaths.VERIFICATIONS)
class VerificationController {
    private final VerificationService service;

    VerificationController(VerificationService service) { this.service = service; }

    @PostMapping
    ResponseEntity<VerificationResponse> create(@Valid @RequestBody CreateVerificationRequest request) {
        Verification created = service.create(request.toCommand());
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(created.id()).toUri();
        return ResponseEntity.created(location).body(VerificationResponse.from(created));
    }
}
```

- Path segments and base paths are constants in `ApiPaths`; version the API (`/v1/...`).
- The controller calls one service method. No repository, no business rules, no `@Transactional`.
- Constructor injection; no `@Autowired` on fields.

## 3. Service and layering

- The service owns the rules and the transaction (`@Transactional`, `readOnly = true` for queries). It takes a command and returns a domain result (`Verification`), never an API DTO.
- It talks to ports for anything external (see `stackcrew-spring-integration-provider`) and to repositories for data. A remote call never runs inside its `@Transactional` method; call first, then persist through another bean.
- Map entity to domain result in the service or a mapper, and domain result to response record in the controller; reuse an existing mapper before writing one.

## 4. Errors as ProblemDetail

- One `@RestControllerAdvice` for the service. Add handlers there rather than catching in controllers.
- Return `ProblemDetail` with the right status: 400 validation, 401/403 auth, 404 not found, 409 conflict, 422 business rule, 502/503 provider failure.
- Domain errors are specific exceptions carrying an error code constant; the advice maps them with a stable, safe `detail` (a constant), never `ex.getMessage()`. Never return `ResponseEntity<String>` for an error and never leak stack traces, provider messages or provider codes.
- Validation failures (`MethodArgumentNotValidException`) are mapped to a `ProblemDetail` with a list of field errors in a typed record, not a `Map<String, Object>`.

## 5. Pagination

- List endpoints take `Pageable` (page, size with a configured maximum) and return a typed page record:

```java
public record PageResponse<T>(List<T> items, int page, int size, long total) {}
```

- Sort only on an allowlist of fields. Never return an unbounded list.

## 6. Idempotency and safety

- A non-idempotent endpoint that creates a resource or moves money takes an `Idempotency-Key` header (constant name) and stores it.
- Check authorization at the object level (`@PreAuthorize` or an ownership check), not only the role.

## 7. Tests

- `@WebMvcTest` for the controller: happy path, validation failure (400 with `ProblemDetail`), not found, forbidden.
- Service unit tests with mocked ports; repository tests with Testcontainers. See `stackcrew-spring-boot-testing`.

## Do not

- Do not return or accept entities; do not reuse one DTO for request and response.
- Do not put validation in the controller body with `if` chains; use Bean Validation.
- Do not hardcode paths, header names or status strings.
- Do not add a new error format; extend the existing `ProblemDetail` advice.
