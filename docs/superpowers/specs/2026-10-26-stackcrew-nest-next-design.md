# stackcrew — Bổ sung: NestJS, Next.js và các rule dùng chung (Plan 2)

> Ngày: 2026-10-26 · Trạng thái: **bản nháp, chờ duyệt**
> Bổ sung cho spec gốc [`2026-10-24-stackcrew-design.md`](2026-10-24-stackcrew-design.md). Phần nào không nhắc ở đây thì giữ nguyên như spec gốc. Chỗ nào hai tài liệu khác nhau thì **tài liệu này thắng** (xem §2.4).
> Quy ước như spec gốc: **[User]** = người dùng đã quyết · **[Claude]** = quyết định của Claude, người dùng có thể bác · **[Đoán]** = giả định chưa được xác nhận.

---

## 1. Ý định và lý do

Team dùng NestJS và Next.js hằng ngày. Khi AI viết code cho hai stack này, các lỗi hay gặp là [User]:
- dùng `any`, hardcode config, viết lại hàm đã có sẵn;
- NestJS: controller trả thẳng entity, không chuyển sang DTO;
- Next.js: không dùng shared component có sẵn mà tự viết cái mới;
- khai báo `interface`/`type` ngay trong file action hoặc service.

Các lỗi này có chung một gốc: AI không biết dự án đã có sẵn gì và đặt ở đâu [Claude]. Vì vậy rule phải nói rõ "tìm cái có sẵn ở đâu trước khi tạo mới", và dự án phải có chỗ khai báo những vị trí đó.

Team còn có hai quy ước áp dụng cho **mọi stack**, kể cả Spring Boot đã làm xong [User]:
1. Mọi entity kế thừa `BaseEntity` có 4 field audit. Bảng multi-tenant kế thừa `BaseTenantEntity`, lớp này kế thừa `BaseEntity`.
2. Mọi lượt gọi HTTP vào và ra đều log **cả body request và response**. PII bị che theo danh sách cấu hình được, có danh sách mặc định.

**Rule viết chung cho mọi dự án.** Tên lớp, đường dẫn, thư viện nội bộ của từng dự án sẽ chỉ định sau, theo từng dự án [User].

## 2. Phạm vi

### 2.1 Plan 2 gồm
1. Language **TypeScript**: rule và guard (§5).
2. Stack **NestJS** (§6) và **Next.js** (§7).
3. Add-on **TypeORM**, dùng chung cho cả hai stack (§8) [Claude].
4. Rule dùng chung mới: entity gốc + audit (§4.1), log body có che PII (§4.2). Sửa nội dung Spring Boot đã có cho khớp (§4.3).
5. Mục `conventions` trong `stackcrew.json` và câu hỏi tương ứng trong phỏng vấn `init` (§9).
6. ESLint config, flat hoặc legacy theo major version phát hiện được, cùng `--wire` cho dự án Node (§10).
7. Fixture, snapshot, test "lint/guard phải fail trên vi phạm cài sẵn", và định nghĩa golden task cho Plan 3 (§11).
8. Việc nhỏ trong backlog: bước 8 của skill `stackcrew-init` đang in đường dẫn `node …/stackcrew.js` trong cache plugin. Phải đổi thành `/stackcrew:sync`, `/stackcrew:add`, `/stackcrew:check` [Claude].

### 2.2 Phi mục tiêu
- Quarkus, React, Angular, Go: để plan sau [User: làm Nest và Next trước].
- Lịch sử thay đổi (ai sửa field nào, giá trị cũ và mới). Chỉ cần 4 field audit [User].
- Ràng buộc import giữa các tầng bằng eslint-plugin-boundaries hoặc dependency-cruiser: để sau [Claude].
- Skill Kafka cho NestJS: team dùng RabbitMQ; add-on `kafka` vẫn áp dụng được nếu dự án bật [Claude].
- Sinh khung ứng dụng (`nest new`, `create-next-app`), publish npm (Plan 3).

### 2.3 Phản mục tiêu (làm xong vẫn coi là hỏng nếu)
- Ví dụ trong rule hoặc skill dùng thư viện ngoài bộ của team (§3). AI chép ví dụ gần như nguyên văn.
- Rule hoặc skill khiến AI tự cài dependency mà không hỏi (spec gốc §7.2, §8.3).
- PII hoặc secret lọt vào log.
- Tên riêng của dự án hay công ty (ví dụ tên package nội bộ), hoặc bất kỳ secret nào, nằm trong catalog hay fixture.

### 2.4 Phần của spec gốc bị thay thế
| Spec gốc | Nội dung cũ | Nay |
|---|---|---|
| §5.5, §8, `core-logging` | Không log toàn bộ body, chỉ allowlist field an toàn | Log cả body request/response, che PII (§4.2) |
| §13 golden task 2 | NestJS: consumer **Kafka** `kyc.completed` | Consumer **RabbitMQ** (§11.2) |
| Chuỗi plan (bộ nhớ dự án, ledger Plan 1) | Plan 2 = 6 stack | Plan 2 = §2.1; 4 stack còn lại sang plan sau |

Spec gốc được thêm ghi chú có ngày tại §5.5 và §13, trỏ về tài liệu này.

## 3. Bộ thư viện mặc định trong ví dụ [User: package.json mẫu của team]

Ví dụ trong rule và skill **chỉ** dùng các thư viện dưới đây. Rule test đi theo công cụ dự án đã cài.

**NestJS 10** (npm): `@nestjs/config`, `@nestjs/typeorm` + `typeorm` 0.3 + `pg`, `class-validator`, `class-transformer`, `@nestjs/mapped-types`, `@nestjs/swagger`, `@nestjs/passport` + `passport-jwt` (xác thực JWT qua JWKS) [User], `@nestjs/axios`, `@nestjs/terminus`, OpenTelemetry SDK, `amqp-connection-manager` + `amqplib`, `ioredis`. Test: Jest + `ts-jest` + `@nestjs/testing`. Repo mẫu **chưa có ESLint**, chỉ có Prettier.

**Next.js 16** (yarn, App Router, React 19), dùng như fullstack: gọi DB trực tiếp bằng `typeorm` + `pg`. UI kiểu shadcn: Radix, Tailwind 4, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Form: `react-hook-form` + `@hookform/resolvers` + `zod`. Env có kiểu qua `@t3-oss/env-nextjs`. Ngoài ra: `zustand`, `next-auth` v5, `@tanstack/react-table`, `pino`, `amqplib`, `ioredis`. Test: Vitest (unit, integration với `vitest.int.config.ts` và Postgres trong docker), Testing Library, Playwright (E2E). ESLint 9 flat config + `eslint-config-next`.

**Thư viện nội bộ dùng chung** (ví dụ một package core của công ty): rule bắt AI tìm trong đó **trước** khi tự viết base class, util hay logger. Tên package không nằm trong catalog. Mỗi dự án khai báo trong `conventions.sharedLibraries` (§9) [User đồng ý ý tưởng; cách khai báo là Claude].

## 4. Rule dùng chung mọi stack

### 4.1 Entity gốc và audit
**Đã chốt** [User]:
- Mọi entity kế thừa `BaseEntity`, gồm 4 field: người tạo, thời điểm tạo, người sửa cuối, thời điểm sửa cuối.
- Bảng multi-tenant kế thừa `BaseTenantEntity`; `BaseTenantEntity` kế thừa `BaseEntity`.
- AI **không gán tay** 4 field audit; framework tự điền.
- `tenantId` lấy từ JWT của request. Mọi truy vấn trên bảng tenant đều lọc theo tenant hiện tại, không truyền tay.
- Dự án đã có `BaseEntity` thì dùng cái có sẵn. Chưa có thì tạo **một lần** ở chỗ dùng chung.

**Claude quyết:**
- Tên field mặc định: `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. Thời gian lưu UTC (`timestamptz` với Postgres). `createdBy`/`updatedBy` là định danh người dùng (claim `sub`).
- `BaseEntity` chỉ chứa 4 field audit. Chiến lược `id` (uuid hay số tăng dần) do dự án chọn.
- Tên lớp gốc, tên claim tenant và cột tenant lấy từ `conventions` (§9). Mặc định: `BaseEntity`, `BaseTenantEntity`, claim `tenant_id`, cột `tenantId`.
- Request không có user (job, consumer, migration): `createdBy`/`updatedBy` = định danh hệ thống cấu hình được, mặc định `system`.
- Rule nằm trong core rule mới `core-persistence`, `categories: [backend, fullstack]`, để không lọt vào stack frontend thuần sau này.
- **Tenant và user ở các đường không có JWT của request:**
  - **Next.js:** repository có tenant đọc tenant và user qua **một helper context dùng chung**.
    - Trong action và route handler, hàm bọc (§4.2) đặt context sẵn.
    - Trong Server Component và hàm tải dữ liệu, helper tự gọi `auth()`.
  - **Consumer message:** `tenantId` (và user nếu có) đi trong **header** của message.
    - Producer luôn gửi header này.
    - Consumer đặt context trước khi xử lý.
    - Spring dùng cùng nguồn này cho `CurrentTenantIdentifierResolver`.
  - **Job và migration:** chạy với định danh `system`. Việc nào đụng bảng tenant thì đặt tenant rõ ràng cho từng lượt.
  - **Endpoint public:** không đọc hoặc ghi bảng tenant, trừ khi dự án tự khai báo cách xác định tenant. Mặc định là không có cách nào.
  - **Thiếu tenant khi đụng bảng tenant:** ném lỗi (fail closed). Không bao giờ trả dữ liệu chưa lọc.
  - **Đọc xuyên tenant** (super admin, báo cáo tổng hợp, job hệ thống): **có**, nhưng chỉ qua một lối đi được duyệt [User: "ok" với câu hỏi có cần lối đi này; Claude hiểu là có].
    - Lối đi là một hàm gọi tường minh, ví dụ `runCrossTenant(reason, fn)`; tên do builder đặt. Không có cách nào khác để tắt lọc tenant.
    - Chỉ chạy khi người gọi có role nằm trong `conventions.crossTenantRoles` (mặc định `["super_admin"]`), hoặc là job `system`. Ngược lại thì ném lỗi.
    - Mỗi lần dùng ghi một dòng log: ai gọi, lý do, thời điểm.
    - Spring: builder kiểm cách bỏ lọc `@TenantId` theo đúng version Hibernate. `CurrentTenantIdentifierResolver.isRoot` chỉ có từ một bản Hibernate 6.x nhất định; Boot 3.0 và 3.1 có thể chưa có, nên cần phương án cho trường hợp đó.

**Cơ chế theo stack:**
| | Audit 4 field | Tenant |
|---|---|---|
| Spring Data JPA | `@MappedSuperclass` + `@EntityListeners(AuditingEntityListener.class)`, `@CreatedDate`/`@CreatedBy`/`@LastModifiedDate`/`@LastModifiedBy`, `@EnableJpaAuditing`, `AuditorAware` đọc user từ security context | `@TenantId` của Hibernate 6 + `CurrentTenantIdentifierResolver` đọc claim [Claude; builder kiểm với tài liệu Hibernate đi kèm Boot 3.x] |
| TypeORM (Nest, Next) | `@CreateDateColumn`/`@UpdateDateColumn` cho thời gian. Người tạo/sửa do một `EntitySubscriber` điền, đọc user từ context của request (AsyncLocalStorage) | Một repository có tenant (tên do builder đặt) tự thêm điều kiện tenant khi đọc và tự gán khi ghi. Không dùng `Repository` thô cho entity tenant |
| Go (plan sau) | struct nhúng | — |

**Ràng buộc cho builder:**
- TypeORM có sẵn một lớp tên `BaseEntity` (Active Record). Rule và ví dụ **cấm** kế thừa lớp đó; entity kế thừa lớp gốc của dự án.
- `repository.update()` và QueryBuilder của TypeORM không đưa entity cho subscriber, nên `updatedBy` có thể không được điền. Skill chỉ dạy những đường ghi mà test chứng minh được là điền đủ 4 field, và nói rõ đường nào bị cấm.
- Context người dùng: Nest đặt AsyncLocalStorage ở tầng xác thực; Next đặt trong wrapper của action/route (§4.2), lấy user từ session `next-auth` (`auth()`), không tự giải mã JWT.

**Lưới chặn:**
- Spring: thêm rule ArchUnit `SC-ENTITY` (frozen như các rule khác): class có `@Entity` phải kế thừa lớp có tên `conventions.baseEntity`.
- TypeScript (ESLint): cấm `import { BaseEntity } from 'typeorm'` (`no-restricted-imports`). Cấm class có decorator `@Entity()` mà không `extends` (`no-restricted-syntax`). Builder kiểm selector trên fixture.
- Không máy nào biết bảng nào là tenant, nên phần tenant dựa vào rule và test: skill testing của mỗi stack có mẫu test "tenant A không đọc được dữ liệu tenant B" và test 4 field audit được điền.

### 4.2 Log body request và response
**Đã chốt** [User]:
- Mọi lượt gọi HTTP vào và ra đều log cả body request và response.
- PII bị che theo danh sách cấu hình được; không cấu hình thì dùng danh sách mặc định.

**Đã duyệt qua playback** [User OK ý của Claude]:
- Log tập trung: một chỗ cho chiều vào, một HTTP client dùng chung cho chiều ra. Không log rải rác trong service.
- Body quá lớn thì cắt. File, multipart, ảnh base64 (selfie, ảnh giấy tờ) chỉ log kích thước.

**Claude quyết:**
- Mỗi lượt gọi **một dòng log**: method, route dạng template (chiều vào) hoặc URL đã làm sạch (chiều ra), status, thời gian, các id (requestId, traceId, userId), body request đã che, body response đã che. Mức log giữ như `core-logging`: INFO cho 2xx/3xx, WARN cho 4xx, ERROR cho 5xx.
- **Bộ che (masker) dùng chung**:
  - Đệ quy vào object và mảng lồng nhau.
  - So khớp tên key không phân biệt hoa thường, bỏ qua `_` và `-` (`national_id` = `nationalId`).
  - **Khớp theo từ:** tách key theo camelCase, `_` và `-`. Key bị che khi khớp nguyên cả key, hoặc khi có một từ nằm trong danh sách.
    - Vì vậy `newPassword`, `confirmPassword`, `customerEmail`, `homeAddress` đều bị che.
    - Không khớp chuỗi con, để `shipping` (chứa "pin"), `company` hay `spanId` (chứa "pan") không bị che nhầm.
  - Thay giá trị bằng `***`.
- **Hai danh sách:**
  - *Secret*, luôn che, không tắt được: `password`, `passwd`, `secret`, `token`, `accessToken`, `refreshToken`, `idToken`, `apiKey`, `clientSecret`, `privateKey`, `authorization`, `cookie`, `setCookie`, `otp`, `pin`, `cvv`, `cvc`.
  - *PII*, cấu hình được. Cấu hình **thay** danh sách mặc định: `email`, `phone`, `phoneNumber`, `mobile`, `fullName`, `dob`, `dateOfBirth`, `address`, `nationalId`, `idNumber`, `cccd`, `cmnd`, `passport`, `passportNumber`, `cardNumber`, `pan`, `accountNumber`.
  - Lý do tách: dự án cấu hình sai danh sách PII cũng không làm lộ mật khẩu hay token.
- **Cấu hình nằm trong config chạy của ứng dụng**, không nằm trong `stackcrew.json`:
  - Spring: `app.logging.mask-fields`, `app.logging.max-body-bytes`, `app.logging.log-bodies` qua `@ConfigurationProperties`.
  - Nest và Next: biến môi trường `LOG_MASK_FIELDS` (cách nhau bằng dấu phẩy), `LOG_MAX_BODY_BYTES`, `LOG_BODIES`, đọc qua `@nestjs/config` hoặc schema env của `@t3-oss/env-nextjs`.
- **Giới hạn kích thước và loại nội dung:**
  - Mặc định cắt body ở 16 KB.
  - `multipart/*`, `application/octet-stream`, `image/*`, `application/pdf` chỉ log content-type và kích thước.
  - Chuỗi trong JSON trông như base64 và dài hơn 1 KB được thay bằng `<base64 N bytes>`.
  - SSE/streaming không log body.
  - Health check và metrics không log.
- **Header**: chỉ log `content-type`, `content-length`, `user-agent`. `Authorization` và cookie không bao giờ xuất hiện.
- **Công tắc** `log-bodies`/`LOG_BODIES`, mặc định bật, để tắt body theo môi trường khi cần (ví dụ lúc sự cố làm log quá tải). Tắt thì vẫn giữ dòng log một lần gọi.
- **Consumer message** (RabbitMQ, Kafka): log payload khi nhận, qua cùng bộ che.

**Cơ chế theo stack:**
- **Spring Boot 3:**
  - Chiều vào: `OncePerRequestFilter` với `ContentCachingRequestWrapper`/`ContentCachingResponseWrapper`, nhớ `copyBodyToResponse()`.
  - Chiều ra: interceptor trên `RestClient`, kèm request factory có buffer để đọc được body response.
  - Builder kiểm API với tài liệu Spring đúng version.
- **NestJS 10:**
  - Chiều vào: interceptor toàn cục cho đường thành công, exception filter cho đường lỗi, cả hai dùng chung một hàm ghi log.
  - Chiều ra: interceptor của axios trên `HttpService.axiosRef`.
  - Logger: pino qua `nestjs-pino` [Claude]. Logger JSON có sẵn của Nest chỉ có từ Nest 11, mà team tối thiểu là Nest 10. Thêm dependency này theo luật "agent hỏi trước" của spec gốc.
- **Next.js 16:**
  - `proxy.ts` không dùng được, vì nó chạy trước route nên không thấy body response. Đã kiểm tài liệu Next 16.1.6: chạy Node runtime, buffer body request tối đa 10 MB.
  - Thay bằng **hàm bọc**: mỗi server action và route handler được bọc bằng hàm logging dùng chung (tên do builder đặt). Hàm bọc cũng đặt context user cho §4.1.
  - Chiều ra: một HTTP client dùng chung bọc `fetch`.
  - Lỗi lọt khỏi hàm bọc: `onRequestError` trong `instrumentation.ts`.
  - Lượt render Server Component không log body; chỉ log lỗi.
  - Không máy nào kiểm được "action đã được bọc chưa", nên dựa vào rule, skill và review.

### 4.3 Sửa nội dung đã có cho khớp
Các file sau đang cấm log body hoặc chưa có entity gốc. Phải sửa trong Plan 2:
- `catalog/core/rules/logging.md`: dòng 15 (Essentials, log một dòng mỗi request) và dòng 34 ("Do not log full bodies…").
- `catalog/stacks/spring-boot/rules.md`: dòng 120 ("never the body…") và 121. Mục "Data access with Spring Data JPA" thêm entity gốc, auditing và tenant.
- `catalog/addons/observability/rules.md:179`: giữ cổng "không PII trong log", thêm ý body được log qua bộ che.
- `catalog/stacks/spring-boot/skills/stackcrew-spring-integration-provider/SKILL.md` §10, khoảng dòng 426–431:
  - Adapter **không tự log body**; HTTP client dùng chung log body đã che.
  - Ảnh và giấy tờ chỉ log kích thước.
- `catalog/stacks/spring-boot/testing.md`: mẫu test 4 field audit và test cô lập tenant.
- `catalog/stacks/spring-boot/wire/StackcrewArchitectureTest.java`: rule `SC-ENTITY`.
- Skill mới cho Spring: `stackcrew-spring-jpa-entity` (entity, migration, entity gốc) và `stackcrew-spring-request-logging` (filter, interceptor, masker, config) [Claude].

## 5. Language TypeScript
- `catalog/languages/typescript/rule.md` (id `lang-typescript`) và `guard.json`.
- Không gắn framework, vì React và Angular ở plan sau dùng lại.

**Nội dung chính:**
- Cấm `any` dưới mọi dạng: `: any`, `as any`, `<any>`, `any[]`, `Record<string, any>`.
- Cấm `object`, `{}`, `Function` làm kiểu.
- Dữ liệu từ ngoài vào dùng `unknown` rồi parse ở biên (zod hoặc class-validator).
- Cấm `@ts-ignore`. `@ts-expect-error` phải kèm lý do.
- Bật `strict`.
- Không gọi `process.env` ngoài module config.
- Không magic string/number: dùng hằng số hoặc object `as const`.
- `interface`/`type` dùng chung nằm trong file riêng, không khai báo trong file service hay action (§10.1).
- Tìm hàm, component, type có sẵn (kể cả trong `conventions.sharedLibraries`) trước khi viết mới.

**Guard (quét phần nội dung mới):**
- các dạng `any` ở trên;
- `@ts-ignore`;
- `process.env.` ngoài file config (danh sách file config do builder đặt, có `env.ts` và `**/config/**`);
- khai báo kiểu trong file service/action (§10.1).

## 6. Stack NestJS
- `stack.json` [Claude]:
  - `id: "nestjs"`, `name: "NestJS"`, `category: "backend"`, `language: "typescript"`, `minVersion: "10.0"`;
  - `globs: ["**/*.ts"]`, `aliases: ["nest"]`;
  - `detect.files: ["package.json"]`, `detect.packageDeps: ["@nestjs/core"]` (so khớp đúng tên);
  - `priority` khác với Next.js.
- **Rules (ý chính):**
  - Cấu trúc module theo Nest CLI: `src/modules/<feature>/` gồm controller, service, `dto/`, `entities/`, `interfaces/`.
  - Controller mỏng: không có logic nghiệp vụ, không gọi repository.
  - **Response luôn là DTO** [User]:
    - Class response DTO có `@Expose()` và `@ApiProperty()`.
    - Map bằng `plainToInstance(XResponseDto, entity, { excludeExtraneousValues: true })` hoặc một mapper riêng.
    - Không trả entity, kể cả khi dùng `ClassSerializerInterceptor` với `@Exclude`.
  - Request DTO dùng `class-validator`; `ValidationPipe` toàn cục với `whitelist`, `forbidNonWhitelisted`, `transform`.
  - Config qua `@nestjs/config` có validate lúc khởi động.
  - Xác thực:
    - `passport-jwt`; service tài nguyên kiểm chữ ký qua JWKS.
    - Kiểm `issuer` và `audience`.
    - Guard toàn cục, có decorator đánh dấu endpoint public.
  - TypeORM theo add-on §8. Migration only.
  - Lỗi: exception domain map sang HTTP trong một exception filter, trả RFC 7807 như `core-backend-api`.
  - Gọi ra ngoài qua `HttpService`, có timeout, log theo §4.2.
  - RabbitMQ theo add-on `rabbitmq` có sẵn: consumer idempotent, có DLX.
- **Skill** (`kind`, tên):
  - task `stackcrew-nest-rest-endpoint`;
  - task `stackcrew-nest-typeorm-entity` (`requiresAddons: ["typeorm"]`);
  - task `stackcrew-nest-rabbitmq-consumer` (`requiresAddons: ["rabbitmq"]`);
  - task `stackcrew-nest-outbound-client` (gọi bên thứ ba: typed DTO, timeout, retry, ACL, log có che);
  - task `stackcrew-nest-request-logging`;
  - testing `stackcrew-nestjs-testing`.
- **Testing:**
  - Jest + `@nestjs/testing` cho unit test.
  - Integration test với Postgres thật và test e2e HTTP. Testcontainers và supertest là dependency mới, nên thêm theo luật "hỏi trước".
  - Giả lập bên thứ ba: không gọi provider thật. Builder chọn công cụ và ghi lý do.

## 7. Stack Next.js
- `stack.json` [Claude]:
  - `id: "nextjs"`, `name: "Next.js"`, `category: "fullstack"`, `language: "typescript"`, `minVersion: "16.0"`;
  - `globs: ["**/*.ts", "**/*.tsx"]`: hai glob riêng, không dùng `{ts,tsx}` vì dấu phẩy trong glob là lỗi M7 trong ledger Plan 1;
  - `aliases: ["next"]`, `detect.files: ["package.json"]`, `detect.packageDeps: ["next"]` (so khớp đúng tên, không bắt nhầm `next-auth` hay `eslint-config-next`);
  - `priority` cao hơn React (plan sau), vì repo Next nào cũng có `react`.
- **Rules (ý chính):**
  - App Router. Mặc định là Server Component; `'use client'` chỉ ở component lá cần tương tác.
  - Code đụng DB, secret, repository chỉ chạy phía server (`import 'server-only'` trong module data).
  - **Không đưa entity xuống client** [User]:
    - Server action, route handler và Server Component truyền props cho client đều map sang DTO hoặc kiểu thuần.
    - Server action trả một kết quả có kiểu (thành công hoặc lỗi), không ném lỗi thô ra client.
  - Server action:
    - parse input bằng schema zod, schema nằm ở file riêng, type suy ra bằng `z.infer`;
    - kiểm đăng nhập (`auth()`) và quyền;
    - gọi `revalidatePath`/`revalidateTag` khi cần;
    - được bọc bằng hàm logging (§4.2).
  - Form dùng `react-hook-form` + `zodResolver` với **cùng** schema.
  - **Dùng component có sẵn trước** [User]:
    - tìm trong `conventions.sharedComponents` (mặc định `src/components/ui`) và các component của feature;
    - bảng dữ liệu dùng component bảng dùng chung trên TanStack Table;
    - không tự viết lại button, input, dialog.
  - Tailwind qua hàm `cn()`, không inline style.
  - Env chỉ đọc qua object `env` của `@t3-oss/env-nextjs`.
  - `zustand` chỉ cho state UI phía client. Dữ liệu server lấy qua Server Component hoặc server action.
  - Mỗi trang có đủ trạng thái loading, empty, error (`loading.tsx`, `error.tsx`, empty state).
  - TypeORM trong Next: theo add-on §8, cộng thêm `DataSource` dùng một instance duy nhất, không tạo lại khi dev server hot reload. Builder kiểm cấu hình Next cần cho TypeORM (decorator, `serverExternalPackages`) với tài liệu Next 16.
- **Skill:**
  - task `stackcrew-next-server-action` (form + schema + action + DTO + trạng thái);
  - task `stackcrew-next-feature-page` (trang Server Component: tải dữ liệu, loading/empty/error, dùng component có sẵn);
  - task `stackcrew-next-route-handler`;
  - task `stackcrew-next-typeorm-entity` (`requiresAddons: ["typeorm"]`);
  - task `stackcrew-next-request-logging`;
  - testing `stackcrew-nextjs-testing`.
- **Testing:**
  - Vitest cho schema, mapper, hàm thuần và server action (repository giả lập).
  - Testing Library cho client component.
  - Integration với Postgres qua cấu hình `vitest.int.config.ts` có sẵn của dự án.
  - Playwright cho E2E. Server Component async không unit test được bằng Vitest, nên kiểm bằng E2E.

## 8. Add-on TypeORM [Claude]
- `catalog/addons/typeorm/`: `languages: ["typescript"]`, `detect.packageDeps: ["typeorm"]`. Áp dụng cho cả Nest và Next, nên rule TypeORM chỉ viết một lần.
- **Nội dung:**
  - entity gốc và tenant theo §4.1;
  - `synchronize: false` ngoài môi trường dev cục bộ; đổi schema chỉ qua migration;
  - transaction qua `DataSource.transaction` hoặc QueryRunner;
  - tránh N+1 (relations, join có chủ đích);
  - mọi truy vấn danh sách có phân trang;
  - không trả entity ra khỏi tầng service.

## 9. Quy ước riêng của dự án (`stackcrew.json`) [Claude]
Thêm mục `conventions`. Field nào thiếu thì dùng mặc định:
```json
"conventions": {
  "sharedLibraries": [],
  "baseEntity": "BaseEntity",
  "baseTenantEntity": "BaseTenantEntity",
  "tenantClaim": "tenant_id",
  "tenantColumn": "tenantId",
  "crossTenantRoles": ["super_admin"],
  "sharedComponents": "src/components/ui",
  "typeFreeFiles": []
}
```
- **Ý nghĩa:**
  - `sharedLibraries`: package hoặc thư mục phải tìm trước khi viết mới.
  - `crossTenantRoles`: các role trong JWT được dùng lối đi đọc xuyên tenant (§4.1).
  - `sharedComponents`: chỉ dùng cho stack frontend/fullstack.
  - `typeFreeFiles`: glob của file không được khai báo kiểu. Để trống thì dùng mặc định của stack (§10.1).
- **Hiện ra ở đâu:**
  - `architecture-profile.md` có thêm mục "Conventions".
  - Rule, guard, ESLint config và ArchUnit lấy tên từ đây, qua placeholder lúc render.
- **Validate và giữ lại:**
  - `validateProfile` kiểm kiểu từng field.
  - `init --force` giữ lại `conventions`, như đang giữ `decisions`, `context`, `java`.
- **Trạng thái wire của dự án Node:** thêm `node: { "wired": boolean }`. `sync --wire` đặt giá trị này, `init --force` giữ lại.
- **Phỏng vấn `init` hỏi thêm:** thư viện nội bộ dùng chung, tên lớp entity gốc, claim tenant, thư mục shared component. Gợi ý phát hiện tự động:
  - đọc `aliases.ui` trong `components.json` của shadcn;
  - tìm class `BaseEntity` trong mã nguồn.

## 10. Lưới chặn

### 10.1 Guard: không khai báo kiểu trong file service/action [User: lỗi hay gặp]
- Guard không dựa vào `'use server'`. Guard chỉ quét phần nội dung mới, mà directive này thường đã nằm sẵn trong file. Vì vậy guard nhận diện file theo **tên** [Claude].
- **Glob mặc định:**
  - Nest: `**/*.service.ts`;
  - Next: `**/actions.ts`, `**/*.actions.ts`, `**/actions/**/*.ts`.
  - `conventions.typeFreeFiles` thay danh sách mặc định.
- Chặn cả `interface` lẫn `type` alias khai báo ở cấp top-level, kể cả không `export` [Claude]. Lối thoát vẫn là `stackcrew-allow`.
- Renderer phải ghép glob từ `conventions` vào `.stackcrew/guard.json`. Hiện glob guard lấy cố định từ catalog, nên chỗ này cần sửa engine.

### 10.2 ESLint
- **Phát hiện major của `eslint`** trong `package.json` (deps và devDeps):
  - ≥ 9: sinh flat config;
  - 8: sinh config legacy;
  - không có ESLint (như repo Nest mẫu): `--wire` đề nghị thêm ESLint 9 và `typescript-eslint`, có hỏi trước.
- **Cách gắn config:**
  - File stackcrew sinh ra là file của stackcrew, nằm trong `.stackcrew/lint/`.
  - `--wire` (có hỏi) thêm một dòng import vào config ESLint của dự án, hoặc tạo config mới nếu chưa có.
  - **Không bao giờ ghi đè** config của người dùng.
- **Luật:**
  - `@typescript-eslint/no-explicit-any`;
  - `@typescript-eslint/no-restricted-types` (`object`, `{}`, `Function`);
  - `no-magic-numbers` đã chỉnh;
  - `no-restricted-properties` cho `process.env` (tắt trong file config);
  - `no-restricted-imports` (`BaseEntity` của `typeorm`);
  - `no-restricted-syntax` (class `@Entity()` không `extends`).
- Mỗi luật phải **fail** trên fixture có vi phạm cài sẵn.

### 10.3 `stackcrew check`
Không đổi cách làm. Bộ pattern của TypeScript, Nest và Next tự vào `check` qua guard.

## 11. Kiểm chứng

### 11.1 Trong repo stackcrew (Plan 2)
- Validator chạy sạch trên catalog mới. Không skill nào có `paths`, description mở đầu bằng "Use when" và có tên stack.
- Snapshot render cho fixture Nest và Next ở cả 4 tool.
- Fixture tự viết từ đầu:
  - không chép `package.json` của team;
  - không có tên package nội bộ hay token.
- ESLint config và guard fail trên vi phạm cài sẵn:
  - `any`;
  - `process.env` ngoài config;
  - `interface` trong `*.service.ts` và `actions.ts`;
  - entity không `extends`;
  - import `BaseEntity` từ `typeorm`.
- ArchUnit `SC-ENTITY` fail trên fixture Spring có entity không kế thừa lớp gốc.
- **Ví dụ có logic phải được chạy thật ít nhất một lần trong một project tạm**, vì AI chép nguyên văn:
  - masker;
  - hàm bọc logging;
  - subscriber audit;
  - repository có tenant;
  - filter/interceptor Spring.
  Chạy được nghĩa là compile được và test được.
- Detect đúng: repo có `next` ra `nextjs`, repo có `@nestjs/core` ra `nestjs`. Repo chỉ có `next-auth` thì không ra Next.

### 11.2 Golden task cho Plan 3 (cập nhật spec gốc §13)
1. **NestJS 10**, task "consumer RabbitMQ cho `kyc.completed`". Kỳ vọng:
   - idempotent, có DLX;
   - message có schema/kiểu rõ;
   - không `any`;
   - payload được log qua bộ che.
2. **NestJS 10**, task "endpoint lấy hồ sơ khách hàng" [Claude]. Kỳ vọng:
   - trả response DTO, không trả entity;
   - request DTO có validate;
   - entity kế thừa lớp gốc;
   - DTO và interface nằm trong file riêng;
   - log request/response có che PII.
3. **Next.js 16**, task "form đăng ký eKYC + server action", cho người dùng đã đăng nhập [Claude]. Kỳ vọng như spec gốc, thêm:
   - dùng component trong `components/ui`;
   - schema và type ở file riêng;
   - action được bọc logging;
   - trả DTO.

## 12. Quyết định và người quyết
| Quyết định | Ai |
|---|---|
| Làm Nest + Next (kèm rule TypeScript) trước, 4 stack còn lại sau | User |
| Entity gốc + `BaseTenantEntity`, chỉ 4 field audit, không lịch sử thay đổi | User |
| Framework tự điền audit; `tenantId` từ JWT; truy vấn tự lọc tenant; dùng `BaseEntity` có sẵn | User (qua playback) |
| Log cả body vào/ra, che PII cấu hình được có mặc định | User |
| Log tập trung; cắt body lớn; file/ảnh chỉ log kích thước | User (qua playback) |
| Bộ thư viện mặc định trong ví dụ (§3); rule test theo công cụ đã cài; Nest chưa có ESLint thì `--wire` đề nghị thêm | User (qua playback) |
| Golden task Nest đổi sang RabbitMQ | User (qua playback) |
| Tên 4 field, `BaseEntity` không chứa `id`, định danh `system` | Claude |
| Secret luôn che; danh sách PII cấu hình thay mặc định; config nằm trong config ứng dụng | Claude |
| Bộ che khớp theo từ, không khớp chuỗi con | Claude |
| Tenant ngoài request: helper gọi `auth()` (Next), header message (consumer), `system` (job); thiếu tenant thì ném lỗi; endpoint public không đụng bảng tenant | Claude |
| Có lối đi đọc xuyên tenant | User ("ok"; Claude hiểu là có) |
| Lối đi đó là một hàm gọi tường minh, giới hạn theo role, có log lý do; role mặc định `super_admin` | Claude |
| 16 KB, base64 > 1 KB, header được log, công tắc `LOG_BODIES`, log payload consumer | Claude |
| pino qua `nestjs-pino` cho Nest; hàm bọc cho Next | Claude |
| Add-on `typeorm`; core rule `core-persistence` | Claude |
| Mục `conventions` và `node.wired` trong `stackcrew.json` | Claude |
| Guard theo tên file, chặn cả `interface` lẫn `type` | Claude |
| Danh sách skill của Nest, Next và hai skill mới của Spring | Claude |
| Thêm golden task "endpoint hồ sơ khách hàng" | Claude |

## 13. Để builder tự quyết
- **Tên** hàm bọc logging, repository có tenant, file config ESLint sinh ra; cách ghép import vào config ESLint của dự án.
- **Selector** `no-restricted-syntax` cho `@Entity()` không `extends`. Phải kiểm trên fixture.
- **Công cụ giả lập bên thứ ba** cho Nest và Next; Testcontainers hay docker compose cho integration test của Nest.
- **Danh sách file config** được phép đọc `process.env`.
- **Cách placeholder `conventions` đi vào rule và guard lúc render**; phần validate tương ứng.
- **Version**: tăng `package.json` lên `0.2.0`, rồi sinh lại plugin theo quy trình release.
