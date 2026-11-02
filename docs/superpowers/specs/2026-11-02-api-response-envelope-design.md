# stackcrew — Chuẩn response chung (envelope) cho Spring Boot, NestJS, Next.js

> Ngày: 2026-11-02 · Trạng thái: **bản nháp, chờ duyệt**
> Thay thế quy định RFC 7807 `application/problem+json` trong spec gốc [`2026-10-24-stackcrew-design.md`](2026-10-24-stackcrew-design.md) và spec [`2026-10-26-stackcrew-nest-next-design.md`](2026-10-26-stackcrew-nest-next-design.md). Chỗ nào khác nhau thì **tài liệu này thắng**.
> Nguồn: [`docs/api-response-structure.md`](../../api-response-structure.md) v2.1 do người dùng viết, cộng các quyết định trong buổi trao đổi ngày 2026-11-02.
> Quy ước: **[User]** = người dùng đã quyết · **[Claude]** = quyết định của Claude, người dùng có thể bác · **[Đoán]** = giả định chưa được xác nhận.

---

## 1. Ý định và lý do

- Mọi API trả về **một cấu trúc root chung** cho cả success lẫn error, để frontend xử lý mọi response theo một cách [User].
- Frontend dịch thông báo theo `errorCode`. Còn `errorNumber` là để **CS nhìn vào biết ngay lỗi thuộc squad nào**. Vì nhiều service có thể ném cùng một `errorCode`, `errorNumber` mang số của service **gốc** gây lỗi, kể cả khi lỗi đi qua nhiều service (§4.3) [User].
- Controller, route handler và server action **chỉ trả dữ liệu hoặc ném exception**. Việc bọc envelope, gán HTTP status và chuyển exception thành error response do tầng chung đảm nhận (interceptor/advice/filter/wrapper), không ai phải tự return envelope [User].
- Người dùng báo lỗi kèm một mã ngắn (`supportCode`) để đội vận hành tra log [User].

Hiện catalog quy định RFC 7807 ở mọi nơi (core rule `backend-api.md`, `error-handling.md`, rule và template của cả 3 stack, kèm test khóa cứng chuỗi `application/problem+json`). Success thì trả thẳng DTO, còn server action của Next.js dùng `{ ok, data } | { ok, error }`. Spec này thay toàn bộ những thứ đó.

## 2. Mục tiêu, không làm, không được làm

**Mục tiêu**
- Rule và template của Spring Boot, NestJS và Next.js (route handler **và** server action) đều sinh ra đúng contract ở §3–§6 [User].
- Controller không tự dựng envelope, không gán status bằng tay ngoài annotation hoặc decorator [User].
- Test của catalog khóa contract mới, giống như đang khóa problem+json.

**Không làm**
- Không viết tool migrate code của các dự án đã áp dụng stackcrew [Claude].
- Không đổi cách outbound client đọc response của provider **bên thứ ba**, vì họ có format riêng [Claude]. Lời gọi giữa các service trong hệ thống (cùng dùng chuẩn này) **thuộc phạm vi**, xem §4.3.
- Không đổi **hành vi người dùng thấy** trên trang Next.js: vẫn chuyển sang trang đăng nhập khi chưa đăng nhập, vẫn hiện chữ "forbidden" ngay trên trang, `notFound()` và `error.tsx` vẫn như cũ. Chỉ code bên dưới đổi theo §5.3 [Claude].
- Không thêm thông tin sort vào contract phân trang (giữ như tài liệu gốc §4.3) [User].

**Không được làm** (dù chạy được vẫn coi là hỏng)
- Một API nào đó trả DTO trần hoặc problem+json bên cạnh envelope (hai format song song) [User].
- Controller phải viết `ApiResponse.ok(...)` hay `ResponseEntity` chỉ để có envelope [User].
- Error response làm lộ stack trace, SQL, hostname, message của exception hay message của provider [User, giữ từ catalog hiện tại].
- Response 204 có body [User + Claude, xem §3.4].

## 3. Contract

### 3.1 Success [User]

```json
{
  "success": true,
  "timestamp": "2026-11-02T02:52:00.000Z",
  "supportCode": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "data": { "id": "USR-001", "name": "John Doe" }
}
```

- **Không có `message`** ở success [User]. Mục 1.6 và mục 3 của `api-response-structure.md` phải sửa theo.
- `data` là object, array hoặc `null`. Collection không phân trang và rỗng thì trả `data: []`, không trả `null` [User, tài liệu gốc].
- Không có `error`.

### 3.2 Error [User]

```json
{
  "success": false,
  "message": "Request validation failed",
  "timestamp": "2026-11-02T02:52:00.000Z",
  "supportCode": "QAZWSX",
  "requestId": "d2142131-d6d7-442d-9d6e-6c14b33f9402",
  "error": {
    "errorNumber": "0710001",
    "errorCode": "VALIDATION_FAILED",
    "details": [
      { "field": "email", "code": "INVALID_FORMAT", "message": "email must be an email" }
    ]
  }
}
```

- `message` là chuỗi tiếng Anh **cố định theo `errorCode`**, lấy từ bảng mã lỗi chứ không lấy từ exception. Frontend dùng nó làm phương án dự phòng khi chưa có bản dịch cho `errorCode` [Claude].
- `details` luôn là array; không có chi tiết thì là `[]` [User].
- `details[].message` nêu quy tắc bị vi phạm, **không bao giờ chứa giá trị người dùng gửi lên** [Claude, giữ từ catalog hiện tại].
- Không có `data`.

### 3.3 Root fields

| Field | Có ở | Quy định |
|---|---|---|
| `success` | cả hai | `true` / `false` |
| `message` | chỉ error | §3.2 |
| `timestamp` | cả hai | ISO 8601 UTC, đuôi `Z`. Cho phép có mili giây; client phải parse được mọi dạng ISO 8601 [Claude] |
| `supportCode` | cả hai | đúng 6 chữ cái in hoa A–Z, sinh ngẫu nhiên cho mỗi request (CSPRNG) [User: tên field · Claude: cách sinh] |
| `requestId` | cả hai | UUID của request (§7) |
| `data` | chỉ success | §3.1 |
| `error` | chỉ error | §3.2 |

HTTP status nằm ở status line và **không lặp lại trong body** [User].

### 3.4 HTTP status của success [User + Claude]

- Mặc định `200`; tạo mới trả `201`.
- **Không dùng `204`.** Người dùng muốn delete cũng có body. RFC 9110 cấm 204 có body: server có thể cắt body, còn `fetch` và axios bỏ qua nó. Vì vậy delete và các action không có payload trả **`200` với `data: null`** [User đồng ý hướng này].
- Với Spring, `@ResponseStatus(HttpStatus.NO_CONTENT)` bị cấm trên controller; nếu có, advice phải báo lỗi chứ không lặng lẽ gửi đi.

### 3.5 Phân trang [User, tài liệu gốc §4.3]

`data` = `{ items, pagination: { page, size, totalElements, totalPages, hasNext, hasPrevious } }`, với `page` **đếm từ 0**. Giữ nguyên các quy ước ở tài liệu gốc §4.3, bổ sung thêm:
- Query param của API cũng đếm từ 0 (`?page=0&size=20`). NestJS và Next.js hiện đếm từ 1 nên phải đổi [Claude].
- URL của trang Next.js (`?page=` trên thanh địa chỉ, người dùng nhìn thấy) **giữ đếm từ 1**; `page.tsx` tự chuyển đổi. Chỉ contract API đếm từ 0 [Claude].
- Trang vượt quá `totalPages` (ví dụ `page=10` khi có 7 trang) trả `200` với `items: []`, `hasNext: false`, `hasPrevious: true`. Không trả 4xx [Claude].
- `size` vượt mức tối đa thì cắt về mức tối đa và trả giá trị đã cắt (tài liệu gốc). `page` âm hoặc `size <= 0` trả lỗi `VALIDATION_FAILED` [User, tài liệu gốc].
- Giữ hai mức trần hiện có trong catalog: `MAX_PAGE_SIZE` và `MAX_PAGE`. Vượt `MAX_PAGE` thì yêu cầu dùng keyset [Claude, giữ từ catalog].

## 4. `errorNumber` và `errorCode`

### 4.1 Format `errorNumber`: `SSCCNNN` [User]

- 7 chữ số liền nhau, **không có dấu `-`** [User]. Regex `^\d{7}$`.
- Trong JSON luôn là **string**, không phải number, để giữ số 0 ở đầu (`"0710001"`) [Claude].
- `SS`: **số của service**, 2 chữ số (`00`–`99`).
- `CC`: **số nhóm lỗi**, 2 chữ số (bảng §4.2).
- `NNN`: số thứ tự, 3 chữ số.
- Ví dụ: `0710001` = service 07, lỗi validation chung.

Quy tắc:
- `SS` là **config lúc chạy của từng service** (Spring `app.service-number`, NestJS/Next.js biến môi trường `SERVICE_NUMBER`). Config được kiểm tra khi khởi động; thiếu hoặc không khớp `^\d{2}$` thì app không boot [Claude]. Lý do không đưa vào `stackcrew.json`: số service là chuyện vận hành, có thể khác nhau giữa các deployment, và nếu đưa vào thì phải đổi schema conventions của stackcrew.
- Ai cấp số service, và danh sách số đã cấp, nằm ngoài catalog. Rule chỉ ghi "lấy từ config, không hardcode" [Claude].
- Lỗi dùng chung (validation, 401, 403, 500…) nằm trong code chung và **tự gắn `SS` của service đang chạy** [User].
- `NNN` từ `001` đến `099` dành cho lỗi chung trong bảng §4.2. Lỗi riêng của domain trong từng service dùng `100`–`999` [Claude].
- `errorCode` là key dịch dùng chung cho frontend, viết `UPPER_SNAKE_CASE`, và **có thể trùng giữa các service** [User]. Lỗi domain có thể dùng lại `errorCode` chung, ví dụ `CustomerProfileNotFound` → `0730101` / `RESOURCE_NOT_FOUND`, hoặc định nghĩa code mới, ví dụ `KYC_ALREADY_SUBMITTED`.

### 4.2 Nhóm lỗi và bảng mã lỗi chung [Claude, dựng từ bảng của tài liệu gốc §6]

Số nhóm được đổi trực tiếp từ prefix chữ của tài liệu gốc. Các dòng có đánh dấu ★ là bổ sung mới.

| CC | Nhóm (prefix cũ) | NNN | `errorCode` | HTTP | `message` |
|---|---|---|---|---:|---|
| 10 | Validation (VAL) | 001 | `VALIDATION_FAILED` | 400 | Request validation failed |
| 11 | Request (REQ) | 001 | `MALFORMED_REQUEST` | 400 | The request body is malformed |
| 11 | | 002 | `METHOD_NOT_ALLOWED` | 405 | The HTTP method is not supported |
| 11 | | 003 | `UNSUPPORTED_MEDIA_TYPE` | 415 | The content type is not supported |
| 11 | | 004 | `INVALID_PARAMETER` | 400 | A query or path parameter is invalid |
| 11 | | 005 ★ | `PAYLOAD_TOO_LARGE` | 413 | The request body is too large |
| 11 | | 006 ★ | `ENDPOINT_NOT_FOUND` | 404 | The endpoint does not exist |
| 20 | Authentication (AUTH) | 001 | `UNAUTHENTICATED` | 401 | Authentication is required |
| 21 | Access (ACL) | 001 | `ACCESS_DENIED` | 403 | You are not allowed to do this |
| 30 | Resource (RES) | 001 | `RESOURCE_NOT_FOUND` | 404 | The resource does not exist |
| 40 | Conflict (CON) | 001 | `BUSINESS_CONFLICT` | 409 | The request conflicts with the current state |
| 41 ★ | Business rule | 001 | `BUSINESS_RULE_VIOLATION` | 422 | The request violates a business rule |
| 50 | Rate limit (RL) | 001 | `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| 80 | Dependency (DEP) | 001 | `DEPENDENCY_UNAVAILABLE` | 503 | A required service is unavailable |
| 80 | | 002 | `BAD_GATEWAY` | 502 | An upstream service returned an invalid response |
| 80 | | 003 | `GATEWAY_TIMEOUT` | 504 | An upstream service did not respond in time |
| 90 | System (SYS) | 001 | `INTERNAL_ERROR` | 500 | An unexpected error occurred |

- Lý do có ★ 422: catalog Spring đang dùng 422 cho vi phạm business rule, còn tài liệu gốc thiếu dòng này. ★ 413: catalog có rule giới hạn kích thước body. ★ 404 endpoint: phân biệt "không có route" với "không có bản ghi".
- Truy cập bản ghi của tenant khác trả **giống hệt** `RESOURCE_NOT_FOUND` của bản ghi không tồn tại, để không ai dò được id [giữ từ catalog hiện tại].
- Ví dụ 409 "email đã tồn tại" ở tài liệu gốc §5.3 được giữ nguyên; người dùng chấp nhận vì đã có rate limit [User].

### 4.3 Lỗi đi qua nhiều service [User: giữ errorNumber gốc · Claude: phần còn lại]

Ví dụ service A (số 07) gọi service B (số 05), B trả error envelope `0530101`.

- **B trả success envelope:** A lấy `data` ra dùng.
- **B trả error envelope** (bất kỳ status nào, trừ trường hợp 401/403 ở dưới): A ném `UpstreamApiError`. Lỗi này mang **nguyên** `errorNumber`, `errorCode`, `message` và `details` của B. Frontend nhận đúng `0530101`, nên CS biết ngay lỗi thuộc squad của B [User]. Trong code chung, `UpstreamApiError` là trường hợp duy nhất không gắn `SS` của service đang chạy.
  - HTTP status: lỗi 4xx của B thì A trả cùng status đó. Lỗi 5xx của B thì A trả `502`, vì đối với client của A thì đây là lỗi ở upstream [Claude].
  - `supportCode`, `requestId` và `timestamp` ở root là **của A**. Các giá trị tương ứng của B được ghi vào log `http_out` của A (`upstreamErrorNumber`, `upstreamSupportCode`, `upstreamRequestId`), để từ `supportCode` của A vẫn lần ra được log của B [Claude].
- **Ngoại lệ, B trả 401/403:** đây là lỗi về thông tin xác thực **giữa A và B** (service token), không phải của người dùng. Nếu chuyển nguyên lỗi này thì frontend có thể đăng xuất người dùng oan. A trả lỗi của chính nó trong nhóm 80 (`0780001`, `DEPENDENCY_UNAVAILABLE`), giống quy tắc retry 401/403 hiện có của catalog [Claude].
- **B không trả envelope** (timeout, lỗi mạng, body không phải envelope hợp lệ): A trả lỗi của chính nó trong nhóm 80 (`0780001`, `0780002` hoặc `0780003`) [Claude].
- Retry và circuit breaker giữ nguyên rule hiện có của catalog. Quy tắc ở đây chỉ áp dụng sau khi đã hết retry.
- Outbound client của 3 stack (NestJS `stackcrew-nest-outbound-client`, Next.js `httpClient`, Spring `stackcrew-spring-integration-provider`) cần có chế độ "service nội bộ" để đọc envelope như trên, tách biệt với chế độ "provider bên thứ ba" đang có [Claude].

### 4.4 Mã của `details[].code` [Claude]

Frontend có thể dịch theo từng field, nên **cùng một quy tắc phải ra cùng một code ở cả 3 stack**. Tập code chung:

`REQUIRED`, `INVALID_FORMAT`, `INVALID_TYPE`, `TOO_SHORT`, `TOO_LONG`, `OUT_OF_RANGE`, `INVALID_VALUE` (dự phòng), `ALREADY_EXISTS`.

Mỗi stack có một bảng ánh xạ từ validator sang tập này: Bean Validation (`NotNull`/`NotBlank` → `REQUIRED`, `Email`/`Pattern` → `INVALID_FORMAT`, `Size`…), class-validator (`isNotEmpty`, `isEmail`, `minLength`…) và zod (`invalid_type` khi thiếu field → `REQUIRED`, `too_small`…). Constraint chưa có trong bảng thì ra `INVALID_VALUE`. Field lồng nhau viết theo dạng chấm, ví dụ `address.city`; nếu là phần tử mảng thì `items[0].sku`.

## 5. Cơ chế theo stack [User: nguyên tắc · Claude: cách làm]

Nguyên tắc chung: controller/handler/action **trả dữ liệu hoặc ném exception có `ErrorCode`**. Tầng chung làm mọi việc còn lại.

### 5.1 Spring Boot

| Thành phần | Việc |
|---|---|
| `ApiResponse<T>` | **Hai type tách biệt** (sealed interface với `SuccessResponse<T>` và `ErrorResponse`), không phải một record có cả `data` lẫn `error`. Lý do: success có `data: null` thì phải giữ key `data`, còn error thì phải bỏ hẳn; một chính sách `@JsonInclude` cho một field không làm được cả hai |
| `PageData<T>`, `Pagination` | Như tài liệu gốc §7. Dựng từ `Page<T>` qua mapper, không serialize thẳng `Page` |
| `ErrorCode` | Enum chứa bảng §4.2: `category`, `seq`, `errorCode`, `HttpStatus`, `message`. Domain thêm enum riêng implement cùng interface |
| `ApiException` | Exception mang `ErrorCode` và `details` tùy chọn. Exception domain kế thừa nó |
| `ApiResponseAdvice` | `ResponseBodyAdvice<Object>`, giới hạn bằng `basePackages` của app. Bỏ qua: body đã là `ApiResponse`, `Resource`, `byte[]`, `StreamingResponseBody`, `SseEmitter`/`ResponseBodyEmitter`, method/class có `@RawResponse`. Actuator và springdoc nằm ngoài `basePackages` nên không bị bọc |
| `GlobalExceptionHandler` | `@RestControllerAdvice`: `ApiException`, `MethodArgumentNotValidException`/`ConstraintViolationException` (→ `SS10001` + details), `HttpMessageNotReadableException` (→ `SS11001`), `HttpRequestMethodNotSupportedException`, `HttpMediaTypeNotSupportedException`, `MaxUploadSizeExceededException`, `NoResourceFoundException`/`NoHandlerFoundException`, `CrossTenantDeniedException` (→ `SS30001`), các exception provider (→ nhóm 80), còn lại → `SS90001` kèm log ERROR có stack |
| `AuthenticationEntryPoint`, `AccessDeniedHandler` | Ghi error envelope 401/403, vì Spring Security chặn request trước khi vào MVC |

- **`ResponseEntity<T>` vẫn được dùng khi cần header**, ví dụ `Location` khi tạo mới (`ResponseEntity.created(location).body(dto)`), `ETag` hay `Retry-After`. Advice bọc phần body của nó. Không được dùng `ResponseEntity` chỉ để đặt status, vì việc đó dùng `@ResponseStatus` [Claude].
- **Handler `void`:** có thể advice không chạy khi handler trả `void` hoặc `null`, nên một delete sẽ không ra `data: null`. Builder phải kiểm chứng điều này với Spring 3.x. Nếu đúng như vậy thì cấm handler `void` trong phạm vi envelope (dùng ArchUnit nếu làm được) và chọn một cách để delete luôn ra `200` + `data: null`, kèm test khóa lại. Rule cấm `@ResponseStatus(NO_CONTENT)` cũng đặt ở ArchUnit hoặc rule nếu advice không bắt được [Claude].
- **Controller trả `String`:** `StringHttpMessageConverter` được chọn trước khi advice bọc, nên sẽ ném `ClassCastException`. Rule **cấm controller JSON trả `String`**; ArchUnit kiểm tra nếu làm được, còn không thì để trong rule [Claude].
- Bỏ `spring.mvc.problemdetails.enabled=true` khỏi rule; mọi lỗi của framework đi qua `GlobalExceptionHandler` [Claude].
- Template mới đặt trong skill `stackcrew-spring-rest-endpoint` (envelope, exception, advice) và `stackcrew-spring-request-logging` (ID ở §7) [Claude].

### 5.2 NestJS

- `TransformInterceptor` global (`APP_INTERCEPTOR`) bọc kết quả của handler. Bỏ qua `StreamableFile`, `@Sse()`, handler dùng `@Res()` và handler có decorator `@RawResponse()`. Endpoint health (terminus) dùng `@RawResponse()` [Claude].
- `AllExceptionsFilter` hiện có viết lại để trả error envelope: `ProblemError` đổi thành `ApiError` mang `ErrorCode`; `RequestValidationError` → `SS10001` + details; vẫn giữ các nhánh body-parser, `HttpException` và `CrossTenantDeniedError` [Claude].
- Status success: `@HttpCode()`; mặc định của Nest đã là 201 cho POST và 200 cho các method khác.
- Swagger: decorator `@ApiEnvelopeResponse(Dto)` (và bản phân trang) để tài liệu hiển thị đúng envelope; không để swagger hiện DTO trần [Claude].
- File `src/common/errors/problem-details.ts` đổi tên theo nội dung mới, ví dụ `api-response.ts` và `error-codes.ts`; vẫn nằm trong skill `stackcrew-nest-request-logging` [Claude].

### 5.3 Next.js

Next.js không có interceptor nên việc bọc nằm trong wrapper [Claude].

- **Route handler:** `withRouteLogging` (hoặc một wrapper đi kèm) nhận giá trị handler trả về và dựng success envelope; status mặc định 200, hoặc truyền 201. Ném `ApiError(ErrorCode, details?)` thì wrapper trả error envelope. `problem-details.ts` và `problemForRefusal` được thay thế.
- **Server action** (cùng shape) [User]: action trả data hoặc ném `ApiError`. `withActionLogging` trả `ApiResponse<T>`:
  - `ApiError` → error envelope;
  - lỗi không lường trước → envelope `SS90001`, log ERROR có stack, **không ném tiếp sang `error.tsx`**;
  - `redirect()` / `notFound()` / các lỗi điều khiển luồng khác của Next.js → ném tiếp (`unstable_rethrow`).
  HTTP status của action luôn là 200; log line vẫn ghi status theo `ErrorCode` như hiện nay (`ACTION_ERROR_STATUS` đổi thành status lấy từ `ErrorCode`).
- Service dùng chung cho action và route ném `ApiError` thay vì trả `ActionResult`. `action-result.ts` (`ok`, `fail`, `ActionErrorCode`) bị thay thế; type phía client là `ApiResponse<T>`, phân biệt bằng `success` [Claude].
- **Loader của trang** (`data.ts`, ví dụ `listKycRegistrations`, dùng chung với `GET /api/v1/kyc-registrations`): trả `PageData` mới (đếm từ 0, `{ items, pagination }`) và ném `ApiError` như các service khác. `src/shared/pagination.ts` chỉ giữ **một** shape trang cho cả route lẫn trang. `page.tsx` đổi `?page=` từ đếm 1 sang đếm 0 trước khi gọi loader, rồi bắt `ApiError`: `UNAUTHENTICATED` → `redirect` sang trang đăng nhập, `ACCESS_DENIED` → hiện chữ forbidden ngay trên trang (như hiện nay), `RESOURCE_NOT_FOUND` → `notFound()`. Lỗi khác ném tiếp lên `error.tsx` [Claude].
- Form (react-hook-form) chuyển `error.details[]` thành `setError(field, …)` và hiển thị chữ theo `errorCode` hoặc `details[].code`, không hiển thị `message` thô nếu đã có bản dịch [Claude].
- Rule trong `nextjs/rules.md` hiện ghi "only unexpected failures throw". Sửa thành: lỗi có chủ đích thì ném `ApiError`, wrapper chuyển thành envelope [Claude].

## 6. Swagger / OpenAPI

Tài liệu API phải hiển thị **envelope thật**, không phải DTO trần: Spring dùng springdoc `OperationCustomizer` hoặc schema generic; NestJS dùng `@ApiEnvelopeResponse`. Error response được khai báo một lần ở mức global [Claude]. Cách làm cụ thể để builder quyết.

## 7. `requestId`, `supportCode`, header

- **Không tạo filter mới.** Mở rộng filter logging đang có: Spring `HttpLoggingFilter` (đã nằm trong security chain trước `CorsFilter`, nên 401/403 cũng có ID); NestJS/Next.js dùng `RequestContext` đang có [Claude].
- `requestId`: UUID. Chỉ nhận header `x-request-id` của client **khi đó là UUID hợp lệ**, ngược lại thì tự sinh. Hiện `LogFields.safeRequestIdOrNew` chấp nhận mọi chuỗi "an toàn", phải siết lại [Claude, theo tài liệu gốc §8].
- `supportCode`: sinh cho mỗi request, không nhận từ client.
- Cả hai được lưu trong request attribute hoặc context **và** MDC/log fields (`requestId`, `supportCode`). Advice, exception handler, security handler và các wrapper đều đọc từ cùng một chỗ, nên body, header và log luôn khớp nhau.
- Header response: `X-Request-Id`, `X-Support-Code`. CORS phải thêm cả hai vào `Access-Control-Expose-Headers` để frontend trên trình duyệt đọc được [Claude].
- `traceId` của W3C/Micrometer giữ nguyên trong log, **không đưa ra body**; tên `traceId` không còn dùng trong contract [User: dùng `supportCode`].

## 8. Những chỗ phải đổi trong repo

- **Core rule:** `catalog/core/rules/backend-api.md`, `error-handling.md`. Đổi các bullet về problem+json thành envelope. Phải giữ trong giới hạn kích thước khối AGENTS.md (`AGENTS_BLOCK_BUDGET` = 16000 byte, `src/render/agents-md.js`). Contract đầy đủ đặt trong skill, rule chỉ nói ngắn và chỉ tới skill [Claude].
- **Rule từng stack:** `catalog/stacks/{spring-boot,nestjs,nextjs}/rules.md` và `testing.md`.
- **Skill và template:** mọi file liệt kê trong mục "Errors", "Response DTOs", "Pagination", "server action", "route handler" của 3 stack. Danh sách đầy đủ lấy bằng grep `problem|ProblemDetail|ActionResult|action-result|PageResponse|PageDto|fieldErrors` trong `catalog/`.
- **Outbound client:** `stackcrew-nest-outbound-client`, `httpClient` của Next.js và `stackcrew-spring-integration-provider` được thêm chế độ "service nội bộ" theo §4.3, kèm test (success, lỗi 4xx/5xx chuyển nguyên `errorNumber` của B, 401/403 của B → nhóm 80 của A, body không phải envelope → nhóm 80).
- **Test:** `test/catalog-{nest,next,spring,cross-stack}.test.js` và các test khác đang khóa chuỗi problem+json. Thêm test khóa contract mới: các key ở root, không có `message` ở success, `errorNumber` khớp `^\d{7}$`, không có 204, có header.
- **Fixture:** `fixtures/{spring-boot,nestjs,nextjs}-minimal` cùng các bước kiểm tra end-to-end.
- **Plugin:** chạy lại `plugin/cli` bằng `src/plugin/build.js`; `test/plugin-drift.test.js` phải pass.
- **Tài liệu người dùng:** cập nhật `docs/api-response-structure.md` lên **v3.0** theo spec này: bỏ `message` ở success, `supportCode`, không dùng 204, `SSCCNNN`, bảng §4.2, phạm vi 3 stack, bỏ chữ "Spring Boot only" [Claude]. Cập nhật README nếu README có nhắc problem+json.
- **Phiên bản:** đây là thay đổi phá vỡ code được sinh ra, nên tăng lên `0.3.0` [Claude].

## 9. Để builder quyết

- Tên file, tên class và cách chia file trong từng skill, miễn đúng vị trí đã nêu ở §5.
- Cách làm OpenAPI cụ thể (§6).
- Rule cấm controller trả `String` (§5.1) dùng ArchUnit hay chỉ ghi trong rule.
- Câu chữ tiếng Anh của `message` trong bảng §4.2 có thể chỉnh, nhưng phải cố định và giống nhau ở cả 3 stack.

## 10. Câu hỏi còn mở

Không còn. Reviewer đã đọc, và các câu hỏi đã được người dùng trả lời (§4.3) hoặc Claude tự quyết (Next.js loader ở §5.3; `ResponseEntity` và handler `void` ở §5.1).
