---
name: stackcrew-spring-rest-endpoint
description: Use when adding or changing a REST endpoint in a Spring Boot service: controller, request and response DTO records, Bean Validation, the common response envelope and error codes, service layering and pagination.
kind: task
---
# Add a REST endpoint (Spring Boot 3)

Write the SC-PREFLIGHT note first: which controller, service and DTOs exist, which constants and error codes you will reuse, and whether the shared `common.api` package below is already in the project.

## Shared files (`{{sc:basePackage}}.common.api`)

Copy each sibling once per service; reuse it after that. They need `stackcrew-spring-request-logging` (`LogFields`, `HttpLoggingFilter`) and the `CrossTenantDeniedException` of `stackcrew-spring-jpa-entity`.

| File | What it is |
|---|---|
| `ApiResponse.java` | `sealed interface ApiResponse<T>` with the package-private records `SuccessResponse<T>` and `ErrorResponse`, plus `ErrorPayload` and `ErrorDetail`; `success(...)` and `failure(...)` are the only factories |
| `ErrorCode.java`, `CommonErrorCode.java` | an error-table row (`category`, `seq`, `code`, `status`, `summary`) and the common table |
| `DetailCode.java` | `details[].code`: `REQUIRED`, `INVALID_FORMAT`, `INVALID_TYPE`, `TOO_SHORT`, `TOO_LONG`, `OUT_OF_RANGE`, `INVALID_VALUE`, `ALREADY_EXISTS` |
| `ErrorNumbers.java` | `format(serviceNumber, code)`: the 7-digit `SSCCNNN` |
| `ServiceNumberProperties.java` | `app.service-number`, two digits, validated at startup |
| `ApiException.java`, `UpstreamApiException.java` | the error you throw; an internal service's error passed on unchanged |
| `RawResponse.java` | opt-out annotation for a method or controller |
| `ApiResponseAdvice.java` | `ResponseBodyAdvice` that wraps what controllers return; reads the ids from the request |
| `GlobalExceptionHandler.java` | `@RestControllerAdvice`: every exception becomes the error envelope |
| `ValidationDetails.java` | Bean Validation failures as `details[]` |
| `ApiSecurityHandlers.java` | 401 and 403 from the security chain as the error envelope |
| `PageQuery.java`, `PageData.java` | validated `page`/`size` query and the `{ items, pagination }` data |
| `EnvelopeOpenApiCustomizer.java` | only with springdoc-openapi: the API docs show the envelope |

`GlobalExceptionHandler` targets Boot 3.4+ (Spring 6.2 `getParameterValidationResults`). On 3.2/3.3 call `getAllValidationResults()` in `ValidationDetails`; on 3.0/3.1 also delete the `HandlerMethodValidationException` and `NoResourceFoundException` handlers.

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

- `jakarta.validation.constraints.*` only. Put constraints on the record components, and `@Valid` on nested records and on list elements (`List<@Valid Item>`).
- Statuses and channels are enums; never raw strings.
- No `Map<String, Object>`, `JsonNode` or entity in a request or response.

## 2. Controller: map, delegate, map

A controller returns its data or throws. `ApiResponseAdvice` wraps the data in the success envelope; it never builds an envelope itself.

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

    @GetMapping("/{id}")
    VerificationResponse get(@PathVariable UUID id) { return VerificationResponse.from(service.get(id)); }

    @DeleteMapping("/{id}")
    void delete(@PathVariable UUID id) { service.delete(id); }
}
```

- Success status: `200` by default, `201` for a create (`ResponseEntity.created(location).body(dto)` when there is a `Location`, else `@ResponseStatus(HttpStatus.CREATED)` on a method that returns the DTO).
- A delete or an action with no payload is a plain `void` method with no `@ResponseStatus`: it answers `200` with `data: null`. Never `204`, never `@ResponseStatus` on a `void` method (Spring then returns before the advice runs, so there is no body), never a `String` return (the String converter is picked before the advice wraps it). ArchUnit rule SC-ENVELOPE fails all three.
- `ResponseEntity` only when a header is needed (`Location`, `ETag`, `Retry-After`); the advice wraps its body. Never `ResponseEntity` just to set a status.
- `@RawResponse` on a method or controller leaves its body as returned: a file download, or a reply whose format someone else fixed. `Resource`, `byte[]`, `StreamingResponseBody` and `SseEmitter` are never wrapped. Actuator and springdoc are outside the advice's `basePackages`.
- Path segments and base paths are constants in `ApiPaths`; version the API (`/v1/...`).
- The controller calls one service method. No repository, no business rules, no `@Transactional`.
- Constructor injection; no `@Autowired` on fields.

## 3. Service and layering

- The service owns the rules and the transaction (`@Transactional`, `readOnly = true` for queries). It takes a command and returns a domain result (`Verification`), never an API DTO.
- It talks to ports for anything external (see `stackcrew-spring-integration-provider`) and to repositories for data. A remote call never runs inside its `@Transactional` method: store the operation (its id is the provider's idempotency key) and commit, call with no transaction open, then persist the result through another bean (`stackcrew-spring-integration-provider` section 8).
- Map entity to domain result in the service or a mapper, and domain result to response record in the controller; reuse an existing mapper before writing one.

## 4. The response envelope and errors

Every response body, success or error, has the same root (spec of the common response envelope):

```json
{ "success": true, "timestamp": "2026-11-02T02:52:00.000Z", "supportCode": "QAZWSX", "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402", "data": {} }
{ "success": false, "message": "Request validation failed", "timestamp": "...", "supportCode": "QAZWSX", "requestId": "...",
  "error": { "errorNumber": "0710001", "errorCode": "VALIDATION_FAILED", "details": [ { "field": "address.city", "code": "REQUIRED", "message": "must not be blank" } ] } }
```

- `supportCode` and `requestId` are the ids `HttpLoggingFilter` put in the request attributes; the advice, the exception handler and the security handlers read them there and set the `x-request-id` and `x-support-code` headers again, so body, headers and log line agree.
- `errorNumber` is `SSCCNNN`: the service number, the category and the sequence of the code. `message` is the code's fixed `summary`, never an exception message. Errors never carry a stack trace, SQL, hostname or provider text.
- Set the service number in `application.yml`, quoted (an unquoted `07` is read as the number 7); missing or not two digits, the service does not start:

```yaml
app:
  service-number: "07"
```

- Throw `ApiException(code)` or `ApiException(code, details)`; `GlobalExceptionHandler` answers it. Domain errors are an enum implementing `ErrorCode` with `seq` 100-999; one that reuses a common code keeps its summary:

```java
public enum VerificationErrorCode implements ErrorCode {
    VERIFICATION_NOT_FOUND(30, 101, "RESOURCE_NOT_FOUND", HttpStatus.NOT_FOUND, CommonErrorCode.RESOURCE_NOT_FOUND.summary()),
    ALREADY_SUBMITTED(40, 101, "VERIFICATION_ALREADY_SUBMITTED", HttpStatus.CONFLICT, "The verification was already submitted");
    // fields, constructor and accessors as in CommonErrorCode
}

throw new ApiException(VerificationErrorCode.ALREADY_SUBMITTED,
        List.of(new ErrorDetail("documentNumber", DetailCode.ALREADY_EXISTS, "already exists")));
```

- Framework errors are mapped once in `GlobalExceptionHandler`: validation (`MethodArgumentNotValidException`, `BindException`, `HandlerMethodValidationException`, `ConstraintViolationException`, a missing or mistyped query parameter) is `VALIDATION_FAILED` with details; a malformed body `MALFORMED_REQUEST`; a wrong media type `UNSUPPORTED_MEDIA_TYPE`; a body over the limit `PAYLOAD_TOO_LARGE`; a mistyped path variable `INVALID_PARAMETER`; a wrong method `METHOD_NOT_ALLOWED` (with `Allow`); an unknown route `ENDPOINT_NOT_FOUND`; a `@PreAuthorize` denial `ACCESS_DENIED`; `CrossTenantDeniedException` the same `RESOURCE_NOT_FOUND` as a missing row; anything else `INTERNAL_ERROR`, logged at ERROR with the stack. Never throw `ResponseStatusException`; add a handler to this class rather than catching in a controller.
- Provider failures (`stackcrew-spring-integration-provider`) get two handlers in `GlobalExceptionHandler`: `ProviderUnavailableException` is `DEPENDENCY_UNAVAILABLE`; `ProviderProtocolException` and an unmapped `ProviderRejectedException` are `BAD_GATEWAY`. An internal service's error envelope is thrown as `UpstreamApiException` and keeps its `errorNumber`.
- `details[]`: one per (field, constraint), `field` a dotted path with `[index]` for list items (`items[1].sku`), `code` from `ValidationDetails` (`NotNull`/`NotBlank`/`NotEmpty` `REQUIRED`, `Email`/`Pattern` `INVALID_FORMAT`, a type mismatch `INVALID_TYPE`, `Size` `TOO_SHORT` or `TOO_LONG`, `Min`/`Max`/`Positive`/`Past`... `OUT_OF_RANGE`, anything else `INVALID_VALUE`), `message` the rule text, never the submitted value.
- Spring Security answers 401 and 403 before MVC: register `ApiSecurityHandlers` on both the exception handling and the resource server (an invalid token goes through the latter). CORS exposes `x-request-id` and `x-support-code`.

```java
http.exceptionHandling(e -> e.authenticationEntryPoint(handlers).accessDeniedHandler(handlers))
    .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()).authenticationEntryPoint(handlers).accessDeniedHandler(handlers));
```

## 5. Pagination

- List endpoints take `@Valid PageQuery query` (`page` 0-based, `size`) and return `PageData<T>`:

```java
@GetMapping
PageData<VerificationResponse> list(@Valid PageQuery query) {
    Page<Verification> page = service.list(PageRequest.of(query.page(), query.size(), VerificationSort.DEFAULT));
    return PageData.of(page.getContent().stream().map(VerificationResponse::from).toList(), page.getNumber(), page.getSize(), page.getTotalElements());
}
```

- `PageQuery` defaults to page 0 and size 20, caps size at 100 and answers the capped value, and refuses a page outside 0-999 or a size below 1 with `VALIDATION_FAILED`. Past page 999 use keyset pagination. A page past the last one is `200` with `items: []`.
- Never serialize a Spring Data `Page`. Sort only on an allowlist of fields. Never return an unbounded list; an empty unpaged list is `data: []`.

## 6. Idempotency and safety

- A non-idempotent endpoint that creates a resource or moves money takes an `Idempotency-Key` header (constant name) and stores it.
- Check authorization at the object level (`@PreAuthorize` or an ownership check), not only the role.

## 7. API docs

- With springdoc-openapi, add `EnvelopeOpenApiCustomizer`: each 2xx response shows `SuccessResponse` with the return type as `data`, and every operation answers `4XX`/`5XX` with the one `ErrorResponse` schema. Without springdoc, skip that file.

## 8. Tests

- `@WebMvcTest` for the controller, importing `ApiResponseAdvice` and `GlobalExceptionHandler`: the happy path asserts `$.success` true and `$.data` with the exact response record; validation failure asserts 400, `$.error.errorCode` `VALIDATION_FAILED` and each `$.error.details[*].field`/`code`; not found and forbidden assert their `errorCode` and status; a delete asserts 200 and `$.data` null. Assert the `x-request-id` and `x-support-code` headers on an error.
- Service unit tests with mocked ports; repository tests with Testcontainers. See `stackcrew-spring-boot-testing`.

## Do not

- Do not return or accept entities; do not reuse one DTO for request and response.
- Do not put validation in the controller body with `if` chains; use Bean Validation.
- Do not hardcode paths, header names or status strings.
- Do not build `ApiResponse` in a controller, add a second error format, or catch an exception only to return an error body; throw `ApiException` and let the advice answer.
