# Nexus — Standard API Response Structure

**Version:** 2.1  
**Platform:** Spring Boot 3.x+ / Java 17+  
**Purpose:** Define a consistent JSON response contract for successful, paginated, and failed API requests.

---

## 1. Design principles

1. Use one common root structure for success and error responses.
2. Keep the actual HTTP status in the HTTP response status line. Do not duplicate it in the JSON body.
3. Put successful payloads under `data`.
4. Put error classification and field-level details under `error`.
5. Keep correlation metadata (`timestamp`, `traceId`, `requestId`) at the root.
6. Use the root `message` as a human-readable summary for both success and error responses.
7. Use a consistent pagination structure for all paginated list endpoints.

## 2. Common response structure

### 2.1 Success response

```json
{
  "success": true,
  "message": "Request processed successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "id": "123",
    "name": "Example"
  }
}
```

### 2.2 Error response

```json
{
  "success": false,
  "message": "Request validation failed",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "error": {
    "errorNumber": "VAL-001",
    "errorCode": "VALIDATION_FAILED",
    "details": [
      {
        "field": "email",
        "code": "INVALID_FORMAT",
        "message": "Email must be a valid email address"
      }
    ]
  }
}
```

## 3. Root fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `success` | Boolean | Yes | Indicates whether the request succeeded |
| `message` | String | Yes | Human-readable summary of the result |
| `timestamp` | String (ISO 8601) | Yes | Time at which the response was generated, preferably UTC |
| `traceId` | String | Yes | Short trace identifier consisting of exactly 6 uppercase letters (`A`–`Z`) |
| `requestId` | String (UUID) | Yes | Unique identifier for the HTTP request |
| `data` | Object / Array / null | Success only | Successful response payload |
| `error` | Object | Error only | Error classification and optional details |

`data` and `error` are mutually exclusive. For a success response, omit `error`. For an error response, omit `data`.

## 4. Success response patterns

### 4.1 Get a single resource — HTTP 200

```json
{
  "success": true,
  "message": "User retrieved successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "id": "USR-001",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### 4.2 Get a collection without pagination — HTTP 200

```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": [
    {
      "id": "USR-001",
      "name": "John Doe"
    },
    {
      "id": "USR-002",
      "name": "Jane Doe"
    }
  ]
}
```

For an empty, non-paginated collection, return `data: []`, not `null`.

### 4.3 Get a paginated collection — HTTP 200

Use this structure for list endpoints that support pagination. Keep the records in `data.items` and pagination metadata in `data.pagination`.

```json
{
  "success": true,
  "message": "Requests retrieved successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "items": [
      {
        "id": "REQ-001",
        "title": "VPN Access Request",
        "status": "APPROVED"
      },
      {
        "id": "REQ-002",
        "title": "GitLab Access Request",
        "status": "PENDING"
      }
    ],
    "pagination": {
      "page": 0,
      "size": 20,
      "totalElements": 125,
      "totalPages": 7,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

#### Pagination fields

| Field | Type | Description |
|---|---|---|
| `items` | Array | Records returned for the current page |
| `pagination.page` | Integer | Current zero-based page index |
| `pagination.size` | Integer | Page size used for the request |
| `pagination.totalElements` | Long | Total number of matching records across all pages |
| `pagination.totalPages` | Integer | Total number of pages |
| `pagination.hasNext` | Boolean | Whether a next page exists |
| `pagination.hasPrevious` | Boolean | Whether a previous page exists |

#### Empty paginated collection — HTTP 200

Return an empty `items` array and valid pagination metadata. Do not return 404 just because the collection is empty.

```json
{
  "success": true,
  "message": "Requests retrieved successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "items": [],
    "pagination": {
      "page": 0,
      "size": 20,
      "totalElements": 0,
      "totalPages": 0,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

**Pagination conventions**

- Use zero-based page numbering (`page = 0` is the first page).
- `size` is the effective page size applied by the server. If the server caps a requested size, return the capped value.
- `totalElements` is the total count after applying filters and before pagination.
- `totalPages` is `0` when `totalElements` is `0`; otherwise it is the ceiling of `totalElements / size`.
- `hasNext` is `page + 1 < totalPages`.
- `hasPrevious` is `page > 0` when the requested page is valid.
- Validate invalid pagination inputs (for example, negative page or non-positive size) and return a standard 4xx error.
- Keep sorting metadata out of this contract unless the API needs to expose it. If needed, define a consistent `sort` object in a future version.

### 4.4 Create a resource — HTTP 201

```json
{
  "success": true,
  "message": "User created successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "id": "USR-003",
    "name": "Alex"
  }
}
```

### 4.5 Update a resource — HTTP 200

```json
{
  "success": true,
  "message": "User updated successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": {
    "id": "USR-003",
    "name": "Alex Smith"
  }
}
```

### 4.6 Delete or action with no response payload — HTTP 200

```json
{
  "success": true,
  "message": "User deleted successfully",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": null
}
```

If the endpoint uses HTTP 204 No Content, return no response body. Do not return the common JSON envelope with a 204 status.

## 5. Error response structure

### 5.1 Error fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `error.errorNumber` | String | Yes | Stable, human-referenceable error identifier, such as `VAL-001` |
| `error.errorCode` | String | Yes | Machine-readable error code, such as `VALIDATION_FAILED` |
| `error.details` | Array | Yes | Additional error details; use an empty array when there are no details |
| `error.details[].field` | String / null | No | Request field associated with the error |
| `error.details[].code` | String | No | Specific detail code |
| `error.details[].message` | String | Yes | Human-readable explanation of the specific detail |

The root `message` is the overall error summary. A detail-level `message` explains a specific field or issue.

### 5.2 Validation error — HTTP 400

```json
{
  "success": false,
  "message": "Request validation failed",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "error": {
    "errorNumber": "VAL-001",
    "errorCode": "VALIDATION_FAILED",
    "details": [
      {
        "field": "email",
        "code": "INVALID_FORMAT",
        "message": "Email must be a valid email address"
      },
      {
        "field": "name",
        "code": "REQUIRED",
        "message": "Name is required"
      }
    ]
  }
}
```

### 5.3 Business conflict — HTTP 409

```json
{
  "success": false,
  "message": "The request cannot be processed because it conflicts with the current state",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "error": {
    "errorNumber": "CON-001",
    "errorCode": "BUSINESS_CONFLICT",
    "details": [
      {
        "field": "email",
        "code": "ALREADY_EXISTS",
        "message": "An account with this email already exists"
      }
    ]
  }
}
```

### 5.4 Internal server error — HTTP 500

```json
{
  "success": false,
  "message": "An unexpected error occurred",
  "timestamp": "2026-11-02T02:52:00Z",
  "traceId": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "error": {
    "errorNumber": "SYS-001",
    "errorCode": "INTERNAL_ERROR",
    "details": []
  }
}
```

Do not expose stack traces, SQL statements, internal hostnames, secrets, tokens, or sensitive implementation details in error responses.

## 6. Standard error catalog

| Error Number | Error Code | HTTP Status | Description |
|---|---|---:|---|
| `VAL-001` | `VALIDATION_FAILED` | 400 | Request fields failed validation |
| `REQ-001` | `MALFORMED_REQUEST` | 400 | Malformed JSON or invalid request structure |
| `REQ-002` | `METHOD_NOT_ALLOWED` | 405 | HTTP method is not supported by the endpoint |
| `REQ-003` | `UNSUPPORTED_MEDIA_TYPE` | 415 | Request content type is not supported |
| `REQ-004` | `INVALID_PARAMETER` | 400 | Query or path parameter is invalid |
| `AUTH-001` | `UNAUTHENTICATED` | 401 | Authentication is required or invalid |
| `ACL-001` | `ACCESS_DENIED` | 403 | Authenticated caller does not have permission |
| `RES-001` | `RESOURCE_NOT_FOUND` | 404 | Requested resource does not exist or is not visible |
| `CON-001` | `BUSINESS_CONFLICT` | 409 | Request conflicts with current business state |
| `RL-001` | `RATE_LIMIT_EXCEEDED` | 429 | Request rate limit has been exceeded |
| `SYS-001` | `INTERNAL_ERROR` | 500 | Unexpected internal server error |
| `DEP-001` | `DEPENDENCY_UNAVAILABLE` | 503 | Required downstream dependency is unavailable |
| `DEP-002` | `BAD_GATEWAY` | 502 | Invalid response received from an upstream service |
| `DEP-003` | `GATEWAY_TIMEOUT` | 504 | Upstream service did not respond in time |

The HTTP status in this table must be set on the actual HTTP response. It must not be added to the JSON response body.

## 7. Java DTO reference

A simple DTO model for Spring Boot:

```java
import java.time.Instant;
import java.util.List;

public record ApiResponse<T>(
    boolean success,
    String message,
    Instant timestamp,
    String traceId,
    String requestId,
    T data,
    ErrorPayload error
) {
    public record ErrorPayload(
        String errorNumber,
        String errorCode,
        List<ErrorDetail> details
    ) {}

    public record ErrorDetail(
        String field,
        String code,
        String message
    ) {}
}

public record PageData<T>(
    List<T> items,
    Pagination pagination
) {}

public record Pagination(
    int page,
    int size,
    long totalElements,
    int totalPages,
    boolean hasNext,
    boolean hasPrevious
) {}
```

Implementation notes:

- Create success and error factory methods so callers cannot accidentally populate both `data` and `error`.
- For success responses, omit `error`; for error responses, omit `data`.
- If `data: null` is part of the contract for a particular success response, configure JSON serialization so that the `data` property is not omitted. A global `NON_NULL` inclusion policy would remove it.
- Build `PageData<T>` from the application's pagination result and map it to the API DTO. Avoid exposing framework-specific `Page` serialization directly as the public API contract.
- Return `ResponseEntity<ApiResponse<T>>` (or the corresponding generic type) so the HTTP status is set independently of the response body.

## 8. Correlation IDs and observability

- `traceId`: exactly 6 uppercase English letters (`A`–`Z`) in this API contract.
- `requestId`: UUID generated per HTTP request.
- Return both identifiers in the JSON body and, preferably, in response headers:
  - `X-Trace-Id`
  - `X-Request-Id`
- Add the identifiers to logging MDC so application logs can be correlated with client reports.
- Generate IDs at the request boundary and clear MDC values after request processing.
- Do not blindly trust arbitrary client-supplied correlation IDs; validate or generate server-controlled values.
- A six-letter trace ID has a limited namespace and can collide. For distributed tracing, retain a standard full trace identifier (for example, the W3C Trace Context trace ID) internally and expose the six-letter value only as a short display/reference ID.

## 9. Spring Boot implementation responsibilities

| Component | Responsibility |
|---|---|
| `ApiResponse<T>` | Common response envelope |
| `PageData<T>` / `Pagination` | Standard paginated success payload |
| `ErrorCode` | Centralized error number, code, and HTTP status catalog |
| `ApiException` | Typed application/business exception |
| `GlobalExceptionHandler` | Map application and request exceptions to standard error responses |
| `RequestCorrelationFilter` | Create/propagate request identifiers, set response headers, populate and clear MDC |
| `AuthenticationEntryPoint` | Produce standard 401 response |
| `AccessDeniedHandler` | Produce standard 403 response |

Ensure exceptions raised by Spring Security are handled through the security handlers, since they may occur before the request reaches MVC exception handling.

## 10. Contract checklist

- [ ] Every JSON response has `success`, `message`, `timestamp`, `traceId`, and `requestId`.
- [ ] Success responses contain `data` and omit `error`.
- [ ] Error responses contain `error` and omit `data`.
- [ ] The root `message` is the summary for both success and error.
- [ ] Error responses contain `errorNumber`, `errorCode`, and `details`.
- [ ] `details` is always an array; use `[]` when no detail is available.
- [ ] Paginated list responses use `data.items` and `data.pagination`.
- [ ] Empty collections return HTTP 200 with an empty array.
- [ ] Actual HTTP status is set on the HTTP response, not duplicated in the JSON body.
- [ ] HTTP 204 responses have no body.
- [ ] No sensitive internal diagnostic information is exposed to clients.
- [ ] Correlation IDs are present in logs and response headers.

---
**End of document**
