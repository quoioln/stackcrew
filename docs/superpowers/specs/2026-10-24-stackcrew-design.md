# stackcrew — Bản thiết kế

> Ngày: 2026-10-24 · Trạng thái: **đã duyệt (2026-10-24)**
> Vị trí dự án: `C:\Working\Projects\SDLC\SourceCode\stackcrew` (cùng cấp với `SDLC/`).
> Quy ước trong tài liệu: **[User]** = người dùng đã quyết · **[Claude]** = quyết định của Claude, người dùng có thể bác · **[Đoán]** = giả định chưa được xác nhận.

---

## 1. Ý định và lý do

**Vấn đề:**
1. AI viết code tùy tiện. Những lỗi hay gặp:
   - dùng `any`, `JsonNode`, `Map<?, ?>`;
   - hardcode giá trị;
   - viết logic inline trong hàm cha thay vì tách common function;
   - dùng design pattern bừa, hoặc thiếu pattern ở chỗ cần.
   Sai xong mới đi sửa thì tốn gấp nhiều lần.
2. `sdlc-workflow` (dự án SDLC) chạy cả quy trình. Mỗi khi nhận một ý tưởng, nó tự kích hoạt PO → BA → … Vì vậy không dùng chung được với superpowers hay các plugin khác: hai bên giành quyền điều phối.

**stackcrew là gì:** một bộ **luật code + skill theo stack** cho đội **dev và testing**, chạy **độc lập hoàn toàn**. Nó nạp luật vào AI agent **trước khi viết dòng code đầu tiên**, đúng định dạng native của từng tool: Claude Code, Cursor, Codex, Antigravity. Nó **không điều phối quy trình**. Spec và plan do superpowers, SDLC hoặc plugin khác viết. stackcrew chỉ bảo đảm code viết ra đúng luật.

**Thành công nghĩa là** [User]: agent không vi phạm rule ngay từ đầu, thay vì làm sai rồi sửa. Ví dụ: với bài toán tích hợp nhiều bên thứ ba (eKYC qua HyperVerge, FINOS, C06, GPay), agent tự đề xuất đúng pattern và đúng hạ tầng (Apache Camel, Kafka…). Agent viết type rõ ràng, dùng constant, tái sử dụng common function, và log đầy đủ để quan sát được trên Loki/Grafana.

---

## 2. Mục tiêu, phi mục tiêu, phản mục tiêu

### Mục tiêu
- **G1 — Phòng hơn chữa** [User]: rule có sẵn trong ngữ cảnh của agent ở cả 4 tool. Rule tự gắn theo loại file đang sửa (sửa `*.java` thì có rule Java/Spring, sửa `*.tsx` thì có rule React).
- **G2 — Skill riêng cho từng stack** [User]: Spring Boot (Java), **Quarkus**, NestJS, Next.js, Go, React, Angular. Có thêm skill testing cho từng stack. **Mỗi repo chỉ một stack** [User].
- **G3 — Setup theo bối cảnh** [User]:
  - `init` hỏi bài toán, quy mô, tiến độ, độ ổn định và hướng mở rộng.
  - Từ đó gợi ý stack (nếu chưa chọn), kiến trúc, design pattern, hạ tầng messaging và observability.
  - Người dùng duyệt các gợi ý, rồi `init` ghi lại thành **hồ sơ kiến trúc** của dự án.
- **G4 — Gợi ý khi nhận task** [User]: trước khi code, vai dev đối chiếu task với hồ sơ và rule. Nó ghi ra pattern định dùng (kèm lý do), những gì tái sử dụng được và những gì cần tạo mới. Xong mới code.
- **G5 — Lưới chặn cuối** [User]: sinh cấu hình lint, static analysis và kiểm tra kiến trúc. Vi phạm thì build fail.
- **G6 — Mở rộng được** [User]: thêm stack, pattern hay rule công ty mà không phải sửa lõi.
- **G7 — Sống chung** [User]: cài chung với superpowers, SDLC hay plugin khác đều không xung đột.

### Phi mục tiêu (không làm)
- Không có các vai PO, BA, Design, Architect toàn hệ thống, Security audit, Deploy, Maintenance.
- Không có feature card, phase banner, sdlc-config hay pipeline.
- Không tự viết spec hay plan. Việc đó thuộc superpowers, SDLC hoặc plugin khác.
- Bản đầu không sinh khung ứng dụng (kiểu Spring Initializr hay `nest new`) [Claude].

### Phản mục tiêu (chạy được nhưng vẫn coi là thất bại)
- **Tự kích hoạt hoặc tự chuỗi quy trình.** Không skill hay rule nào được có câu kiểu "khi người dùng gửi ý tưởng thì làm X". Không skill nào được tự gọi bước tiếp theo.
- **Skill mô tả quá rộng nên fire ở mọi lượt chat.** superpowers ép gọi skill chỉ cần có 1% khả năng liên quan. Vì vậy cách viết `description` là **yêu cầu thiết kế**, không phải trau chuốt câu chữ (xem §7.3).
- **Bệnh pattern** (pattern-itis): ép pattern vào chỗ không cần. Mỗi pattern guide phải có mục "**không** dùng khi".
- **Luật lệch nhau giữa các tool**: cùng một nguồn nội dung, chỉ khác cách đóng gói.
- **Dự án cũ đỏ build khắp nơi** ngay sau khi `init`.
- **Context phình to**: rule always-on phải ngắn. Phần dài để vào rule theo đường dẫn file, hoặc vào skill tải khi cần.

---

## 3. Ràng buộc
- Repo, npm package và Claude Code plugin **riêng**. **Không phụ thuộc** SDLC, không đọc hay ghi `docs/sdlc/` hay mục `## SDLC Workflow` [User].
- Hỗ trợ 4 tool: Claude Code, Cursor, Codex, Antigravity [User].
- **Mỗi repo chỉ có một stack** [User]: NestJS, **hoặc** Next.js, **hoặc** Spring Boot, **hoặc** Quarkus (React, Angular, Go cũng vậy). Không có monorepo nhiều stack. Hệ quả:
  - hồ sơ có đúng một stack chính, cộng các add-on (Kafka, Camel, RabbitMQ/Redis, observability);
  - detect ở gốc repo là đủ;
  - chỉ sinh rule và skill của stack đó.
- **Version thấp nhất của dự án cũ** [User]: Spring Boot **3.x** (tức `jakarta.*`, Java 17+), Next.js **16** (App Router), NestJS **10**.
  - Các stack người dùng không nêu version [Claude]: Quarkus 3.x, Angular 17+ (standalone + signals), React 19, Go 1.22+ với golangci-lint v2.
  - Rule và ví dụ code viết cho các mốc này. Không hỗ trợ Spring Boot 2 / `javax.*`.
- **CI: Jenkins** [User].
- Đã kiểm chứng từ tài liệu Claude Code:
  - Plugin **không ship được rule always-on hay rule theo path**. File `CLAUDE.md` trong plugin không được nạp, plugin cũng không có thư mục `rules/`. → **`init` phải ghi rule vào chính dự án.** Skill theo stack và agent vai cũng được sinh vào dự án (§9.2). Plugin chỉ mang skill lệnh và hook.
  - `.claude/rules/**/*.md` hỗ trợ frontmatter `paths:` (glob). Rule không có `paths` được nạp ngay khi mở phiên.
  - Subagent nhận CLAUDE.md và `.claude/rules/`, **trừ** Explore và Plan. Subagent gọi được skill qua tool Skill. Trường `skills:` trong agent dùng để preload skill.
  - Skill có trường `paths` để giới hạn tự kích hoạt theo loại file. `description` cộng `when_to_use` bị cắt ở 1.536 ký tự.
  - PreToolUse hook trên `Edit|Write` chặn được thao tác (exit 2 hoặc `permissionDecision: deny`). SessionStart hook bơm được ngữ cảnh, tối đa khoảng 10.000 ký tự.
- **Windows là môi trường chính** của người dùng. Hook và script viết bằng **Node.js**, không dùng bash, để chạy được trên mọi hệ điều hành [Claude].
- CLI là **Node ≥ 18, ESM, không có runtime dependency**, giống SDLC [Claude].
- Nội dung rule và skill viết bằng **tiếng Anh**, vì agent tuân thủ tốt nhất. Hướng dẫn sử dụng viết bằng **tiếng Việt** [Claude, người dùng không phản đối].

---

## 4. Kiến trúc tổng thể

### 4.1 Ba lớp phòng thủ
| Lớp | Cơ chế | Khi nào tác dụng | Tool |
|---|---|---|---|
| **L1 — Ngữ cảnh (phòng)** | Rule always-on (ngắn) + rule theo glob + skill theo việc + vai/agent | Trước và trong khi viết | Cả 4 |
| **L2 — Chặn lúc ghi file** | Claude: PreToolUse hook (Node script) chặn nội dung mới chứa cấu trúc bị cấm, báo mã rule và cách sửa | Ngay lúc ghi | Claude Code (tool khác: xem §9) |
| **L3 — Chặn lúc build** | Cấu hình lint, static analysis và arch-test sinh theo stack. CI fail khi vi phạm | Build hoặc CI | Mọi tool và cả người viết tay |

### 4.2 Các thành phần trong repo `stackcrew` [Claude]
```
stackcrew/
├── catalog/                    # NGUỒN DUY NHẤT — markdown/json, không dồn vào cli.js
│   ├── core/always-on.md       # luật lõi ngắn, luôn bật (SC-*, pre-flight, cổng quyết định)
│   ├── core/rules/*.md         # luật chung chi tiết (port từ SDLC DEV_QUALITY_RULES)
│   ├── languages/<lang>/       # rule.md + guard.json (java, typescript, go)
│   ├── stacks/<stack>/         # stack.json + rules.md + testing.md + skills/ + lint/
│   ├── addons/<addon>/         # addon.json + rules.md (kafka, rabbitmq, camel, observability)
│   ├── skills/<skill>/         # skill dùng chung: pattern guide (+ patterns/*.md, idiom Java/TS/Go), messaging choice, init (+ advisor chọn stack/kiến trúc)
│   └── roles/*.md              # tech-lead, developer, tester (template theo stack)
├── src/                        # CLI: đọc catalog + hồ sơ dự án → render ra từng tool
├── bin/stackcrew.js
├── plugin/                     # Claude Code plugin — SINH từ catalog (như lệnh `plugin` của SDLC)
├── fixtures/                   # dự án mẫu để kiểm chứng (§13)
└── docs/
```
**Khác SDLC:** nội dung tách thành file theo stack và theo pattern. Thêm stack mới thì thêm một thư mục, CLI tự phát hiện, không phải sửa một file 4.000 dòng (G6).

**Lệnh CLI** [Claude, tên lệnh do builder chốt]:
- `init`: phỏng vấn hoặc đọc hồ sơ, rồi render
- `sync`: render lại sau khi sửa hồ sơ, catalog hoặc nâng version
- `add <addon...>`: thêm add-on (kafka, camel…) vào hồ sơ rồi sync. Mỗi repo một stack nên **không có `add-stack`**; thêm stack mới vào catalog là việc của người bảo trì stackcrew (§10).
- `list`
- `detect`
- `check`: quét các dòng **được thêm** (git diff so với base) bằng **chính bộ pattern cấm của guard hook**. L2 và L3 dùng chung một nguồn.
- `plugin`: sinh lại `plugin/`

Riêng Claude Code có thêm skill gọi tay: `/stackcrew:init`, `/stackcrew:sync`, `/stackcrew:check`, `/stackcrew:add`.

---

## 5. Nội dung luật

### 5.1 Coding standard lõi — các luật người dùng nêu đích danh [User]
Mỗi luật có **mã** (để hook, lint và review trích dẫn), **lý do**, **cách đúng**, **ví dụ sai/đúng theo từng ngôn ngữ** và **ngoại lệ hợp lệ**.

| Mã | Luật | Cách đúng | Ngoại lệ |
|---|---|---|---|
| `SC-TYPE` | Cấm kiểu "tùy tiện": `any`/`unknown` để lọt ra ngoài ở TS; `JsonNode`, `Map<String,Object>`, `Map<?,?>`, `Object` làm DTO ở Java; `interface{}`/`any`, `map[string]interface{}` ở Go | Định nghĩa class, record, DTO, struct hoặc type tương ứng; validate tại biên (zod, Bean Validation, struct tag) | Chỉ ngay tại biên deserialize payload động, và phải map sang type ngay lập tức. Cần comment `stackcrew-allow: SC-TYPE <lý do>` |
| `SC-CONST` | Cấm magic string và magic number | Constant, enum hoặc config. **Tìm constant có sẵn trước** khi tạo mới. Gom constant theo domain | Số 0 và 1 hiển nhiên, message trong test |
| `SC-REUSE` | Cấm viết inline logic lặp lại hoặc logic là một concern riêng ngay trong hàm cha | **Tìm common function/util có sẵn trước**. Tách thành hàm hoặc service dùng chung, mỗi hàm một mức trừu tượng | — |
| `SC-PATTERN` | Cấm dùng pattern không có tín hiệu cần, và cấm thiếu pattern khi tín hiệu đã rõ | Theo pattern guide (§5.3) và hồ sơ kiến trúc | — |
| `SC-PREFLIGHT` | Cấm viết code trước khi làm pre-flight | Xem §7.2 | Task Trivial (1 dòng, không logic mới) |

### 5.2 Port từ SDLC (tinh gọn, bỏ phần quy trình)
- `DEV_QUALITY_RULES` (`SDLC/bin/cli.js:3325-3486`): DoD, test quality, type safety, error handling, logging/MDC/redaction/request logging/ORM logging, performance, security, git/PR, dependency, i18n, API/data/resilience/eventing, brownfield. Chia thành `catalog/core/*.md`. Phần "living guideline", "phase checkpoint" và feature card **bỏ**.
- `TECH_STACKS` (`SDLC/bin/cli.js:3711+`): java, typescript, nodejs, spring-boot, spring-jpa, quarkus, nestjs, nextjs, angular, typeorm, kafka, rabbitmq. Chuyển thành `catalog/stacks/*`.
- Logic `detectStacks` và `scan` của SDLC dùng cho `detect` và brownfield.
- **Giữ thống nhất về Lombok** [Claude]:
  - DTO bất biến ưu tiên **`record`** (Java 17+), giống rule SDLC.
  - Lombok `@Builder` dùng cho class có **nhiều field tùy chọn**, hoặc khi `record` không phù hợp (cần kế thừa, cần builder cho record lớn).
  - Cấm Lombok trên JPA entity, theo SDLC. Cấm `@Data` trên entity.

### 5.3 Pattern guide [User nêu danh sách; Claude bổ sung các mục đánh dấu ⁺]
Mỗi pattern một file, theo khuôn cố định:
**Tín hiệu nhận biết → Dùng khi → KHÔNG dùng khi → Idiom theo ngôn ngữ (Java/Spring · TS/Nest/React/Angular · Go) → Ví dụ ngắn → Anti-pattern hay gặp ở AI.**

| Pattern | Tín hiệu điển hình | Ghi chú idiom |
|---|---|---|
| Template Method | Nhiều luồng chung khung, khác vài bước (gọi provider: auth → call → map → audit) | Go: hàm bậc cao hoặc interface các bước, không dùng kế thừa |
| Factory / Abstract Factory | Chọn implementation theo tham số runtime; họ sản phẩm đi cùng nhau | Spring: map bean theo key / `ObjectProvider`; Nest: provider token |
| Adapter | Bọc API bên thứ ba về một port nội bộ | Mỗi provider một adapter |
| Bridge | Hai trục thay đổi độc lập (loại nghiệp vụ × kênh/provider) | Hiếm. Phải chứng minh có đủ hai trục |
| Builder | Đối tượng nhiều tham số tùy chọn, bất biến | Java: `record` khi ít field; Lombok `@Builder` khi nhiều field tùy chọn (không dùng trên entity); Go: functional options; TS: object literal + type |
| Strategy | Thuật toán hoặc hành vi hoán đổi được theo ngữ cảnh | TS/Go: map function là đủ khi không có state |
| Singleton | Một instance dùng chung | Dùng scope của DI container (bean, provider); Go: `sync.Once`. Cấm global mutable state |
| Outbox | Ghi DB và phát event phải nhất quán | Bắt buộc khi đã có broker và có dual-write |
| Decorator⁺ / Chain of Responsibility⁺ | Thêm hành vi xuyên suốt (retry, log, metric); pipeline xử lý nhiều bước | Interceptor (Nest), filter (Spring), middleware (Go) |
| Anti-Corruption Layer⁺ | Model của bên thứ ba khác model nội bộ | Lõi của bài toán tích hợp: không để DTO của provider lọt vào domain |
| Circuit Breaker / Retry / Bulkhead⁺ | Gọi mạng ra bên ngoài | Resilience4j, cockatiel/opossum (Node), gobreaker (Go) |
| Repository / Unit of Work⁺ | Trừu tượng hóa persistence | — |

**Pattern kiến trúc** (dùng lúc `init`): layered, hexagonal (ports & adapters), modular monolith, microservices, CQRS, event-driven. Mỗi cái có tín hiệu "dùng khi / không dùng khi" gắn với quy mô và hướng mở rộng. Frontend có: feature-sliced / feature folders, container–presentational, cách quản lý state (local, server-state như TanStack Query, store như NgRx/signal store).

### 5.4 Tích hợp và messaging
- **Apache Camel chỉ áp dụng cho stack JVM** (Spring Boot, Quarkus) [Claude]. Dùng cho định tuyến nhiều provider, transform, retry/redelivery, DLQ, throttling, theo Enterprise Integration Patterns.
- Với **NestJS và Go**, guide đưa phương án tương đương:
  - Adapter + registry + pipeline tự viết, kèm thư viện resilience.
  - Hàng đợi: BullMQ (Node), Watermill (Go).
  [Claude — builder chọn thư viện cụ thể.]
- **Cây quyết định "pub/sub hay Kafka":**
  - **Event nội bộ trong process** (Spring `ApplicationEvent`, Nest `EventEmitter`, Go channel): cùng một service, không cần bền vững.
  - **Pub/sub nhẹ** (RabbitMQ, Redis Pub/Sub/Streams, cloud Pub/Sub): phân phối việc hoặc task queue, routing phức tạp theo key, volume thấp đến vừa, không cần replay, cần ack/TTL/DLX cho từng message, vận hành đơn giản.
  - **Kafka**: cần replay hoặc lưu lâu, thứ tự theo key, throughput cao, nhiều consumer độc lập đọc theo nhịp riêng, audit trail hoặc event sourcing, stream processing.
  - [Đoán] "pub/sub" người dùng nói là RabbitMQ, Redis hoặc cloud Pub/Sub nói chung. Guide phủ cả ba.

### 5.5 Observability [User: logging, Grafana, Loki]
- Log JSON có cấu trúc ra stdout. Promtail hoặc Grafana Alloy thu log về **Loki**.
- **Label Loki ít giá trị (low-cardinality)**: `service`, `env`, `level`. `traceId`/`requestId` nằm **trong dòng log**, không làm label.
- **Grafana**: dashboard theo RED (Rate, Errors, Duration) cho từng service và từng provider bên thứ ba. Alert theo tỉ lệ lỗi, latency, consumer lag, số lượng DLQ.
- Trace và metric dùng OpenTelemetry. Metric đi Prometheus. Trace đi Tempo [Đoán — người dùng chỉ nêu Loki/Grafana].
- Cấu hình mẫu theo stack: logback JSON + MDC (Spring), pino + AsyncLocalStorage (Nest/Node), `log/slog` + context (Go). Phần redaction và request/HTTP-client logging lấy từ SDLC.
- Bản đầu chỉ có tài liệu và snippet cấu hình. Dashboard JSON mẫu để bản sau [Claude].

### 5.6 Gợi ý chọn stack [User: theo quy mô, tiến độ, độ ổn định, mở rộng]
Một bảng quyết định dùng lúc `init` khi người dùng chưa chọn stack [nội dung là Claude đề xuất, builder hoàn thiện]:
- **Spring Boot**: hệ dài hạn, nặng tích hợp hoặc giao dịch, cần độ ổn định cao, team Java, cần hệ sinh thái rộng.
- **Quarkus**: JVM cloud-native, khởi động nhanh, tốn ít bộ nhớ, cần native image, chạy dày đặc trên K8s hoặc serverless. Vẫn dùng được Camel (Camel Quarkus).
- **NestJS**: team TypeScript, quy mô vừa, cần ra nhanh, làm BFF hoặc API.
- **Next.js**: sản phẩm web cần SEO/SSR, team nhỏ làm fullstack, tiến độ gấp. **Không** dùng cho backend nặng về tích hợp.
- **Go**: throughput cao, latency thấp, nhiều gọi đồng thời, gateway, service nhỏ.
- **React SPA** cho UI linh hoạt. **Angular** cho ứng dụng doanh nghiệp lớn, nhiều form, cần cấu trúc chặt. **Next.js** khi cần SSR/SEO.
- Go: [Đoán] dùng `net/http` + `chi` (gin là lựa chọn thay thế). Rule viết theo cách viết Go thông thường.

---

## 6. Setup (`init`)

### 6.1 Luồng
1. **Phát hiện**: dự án mới hay đã có code. Nếu có code thì detect stack (port từ SDLC).
2. **Phỏng vấn bối cảnh** (agent hỏi từng câu, có thể bỏ qua câu đã rõ):
   - bài toán và domain;
   - số lượng và loại hệ thống tích hợp;
   - quy mô (người dùng, TPS);
   - tiến độ;
   - yêu cầu ổn định;
   - hướng mở rộng (ví dụ "sẽ thêm bao nhiêu provider eKYC");
   - kỹ năng của team;
   - stack (đã chọn hay cần gợi ý);
   - các AI tool đang dùng.
3. **Đề xuất kèm lý do**:
   - stack (nếu cần);
   - kiến trúc;
   - pattern cho từng vùng (ví dụ provider: Adapter + Strategy/Factory registry + Template Method + ACL + Circuit Breaker);
   - messaging (Camel, Kafka hay pub/sub nhẹ);
   - observability;
   - chiến lược test.
   Kèm **đề xuất bổ sung chủ động** cho những gì người dùng chưa nghĩ tới, ví dụ idempotency key cho callback từ provider, hay contract test bằng WireMock.
4. **Người dùng duyệt hoặc sửa.**
5. **Ghi hồ sơ kiến trúc**:
   - `stackcrew.json`: máy đọc; nguồn để `sync`.
   - `docs/stackcrew/architecture-profile.md`: người đọc; mỗi quyết định có lý do và các phương án đã loại.
   [Claude — tên file do builder chốt.]
6. **Render** (§9): rule, skill, vai/agent và cấu hình lint cho các stack và tool đã chọn. **Chỉ dựng vai cho những stack đã chọn.**
7. **In tóm tắt**: đã ghi những gì, bước tiếp theo, cách thêm stack hoặc rule.

### 6.2 Ai làm phần nào [Claude]
- **Phỏng vấn và đề xuất** do agent làm, qua skill `stackcrew-init`. Skill này ship cho cả 4 tool. Lý do: phần này cần suy luận, CLI thuần không làm được.
- **Render** do CLI làm. Đây là phần tất định, chạy lại được, không phụ thuộc AI.
- CLI vẫn có chế độ không cần AI: `init --stack spring-boot,react --tools claude,cursor` để dựng nhanh, bỏ qua phỏng vấn.

### 6.3 Dự án đã có code [Claude — người dùng chưa trả lời, Claude tự chọn]
- Rule áp dụng **đầy đủ cho code mới và code bị sửa**. Không bắt sửa code cũ.
- Lint/arch-check chạy ở **chế độ chỉ trên phần thay đổi**: ArchUnit `FreezingArchRule`; `golangci-lint --new-from-rev`; ESLint trên các file đã đổi. Coverage, lint và finding chỉ được phép tốt lên.
- **Không ghi đè cấu hình lint sẵn có.** Cấu hình stackcrew nằm ở file riêng để import vào, trừ khi người dùng truyền `--force`.

---

## 7. Khi một vai dev nhận task

### 7.1 Nguyên tắc
stackcrew **không giành quyền điều phối**. Task có thể đến từ superpowers (plan → subagent), từ SDLC, hoặc người dùng gõ trực tiếp. stackcrew chỉ can thiệp vào **cách viết code** của task đó.

### 7.2 Pre-flight (nằm trong rule always-on, không phải skill)
Trước khi viết code cho một task không tầm thường, agent ghi ra một **ghi chú triển khai ngắn (3–8 dòng)**:
1. Vùng và module chịu ảnh hưởng, đối chiếu với `architecture-profile.md`.
2. **Tái sử dụng**: common function, util, constant, DTO đã có. Agent phải search trước rồi mới ghi.
3. **Tạo mới**: type, DTO, constant, hàm dùng chung.
4. **Pattern** định dùng và lý do (theo tín hiệu trong guide), hoặc "không cần pattern" và lý do.
5. **Đề xuất thêm** nếu có, ví dụ "provider này nên có circuit breaker và idempotency".

Sau đó **code tiếp luôn**. Agent chỉ **dừng lại hỏi** khi có quyết định lớn [Đoán, người dùng không phản đối]:
- thêm hạ tầng mới (Kafka, Camel, broker);
- dùng pattern hoặc kiến trúc **lệch** khỏi hồ sơ;
- thêm dependency lớn.

Mọi quyết định mới đều được cập nhật vào hồ sơ.

### 7.3 Skill theo việc: mô tả hẹp, gắn `paths`
- Mỗi skill ứng với **một loại việc cụ thể** và gắn với stack. Ví dụ:
  - `spring-integration-provider`: thêm provider bên thứ ba;
  - `spring-kafka-consumer`;
  - `nest-rest-endpoint`;
  - `react-feature-component`;
  - `angular-form`;
  - `go-http-handler`;
  - `<stack>-testing`.
- **Quy tắc viết `description`** (bắt buộc, có kiểm tra tự động trong CI của repo stackcrew):
  - Mở đầu bằng loại việc ("Use when adding a new third-party provider adapter in a Spring Boot service…").
  - Không có từ chung chung kiểu "any code", "always", "whenever the user…".
  - Không gọi skill khác như một bước tiếp theo.
- Mỗi repo một stack, và `init` chỉ sinh skill của stack đó, nên **không có chuyện skill của stack khác fire nhầm**. Việc còn lại là giới hạn trong cùng stack:
  - Claude Code: dùng `paths` để thu hẹp theo thư mục hoặc loại file (ví dụ skill provider chỉ fire trong `**/integration/**`).
  - Cursor, Codex, Antigravity: dựa vào câu chữ của description (§9.1, chỉ `name` + `description` là chắc chắn được chấp nhận).

### 7.4 Vai (team) [User: build team; Claude: chi tiết]
| Vai | Trách nhiệm | Model gợi ý (Claude Code) |
|---|---|---|
| Tech Lead | Chốt pattern và kiến trúc lúc init, duyệt các quyết định lệch hồ sơ, review theo rule | opus |
| Backend `<stack>` (spring-boot / quarkus / nestjs / go) | Code theo rule + pattern guide + skill của stack | sonnet |
| Frontend `<stack>` (react / nextjs / angular) | Như trên | sonnet |
| Tester `<stack>` | Unit test, integration test (Testcontainers), **giả lập bên thứ ba** (WireMock/mock server) cho bài toán tích hợp, E2E (Playwright) cho web | sonnet |

- Trên Claude Code: mỗi vai là một subagent `.claude/agents/stackcrew-<vai>.md`, **sinh vào dự án** để preload đúng skill của stack đã chọn bằng `skills:`. Plugin agent không biết dự án đang dùng stack nào [Claude].
- Trên tool khác: xem §9.
- **Cách gọi vai** [Claude]:
  - Vai chỉ chạy khi **được gọi đích danh**: người dùng gọi tên vai, hoặc plan của superpowers/SDLC ghi rõ vai đó.
  - Description của agent viết hẹp, **không** để tool tự giao việc (tránh phản mục tiêu "fire bừa").
  - **Bảo đảm cốt lõi không phụ thuộc vai.** Rule nạp vào *mọi* agent, kể cả implementer general-purpose của superpowers. Vai là tiện ích để giao việc có chủ đích, có sẵn skill đúng stack.
- **Ai duyệt quyết định lệch hồ sơ** [Claude]: agent đang code **dừng lại hỏi người dùng** (§7.2). Tech Lead là vai người dùng gọi khi muốn có đề xuất hoặc review pattern/kiến trúc. Tech Lead không phải một cổng duyệt tự động.

---

## 8. Lưới chặn (L2 + L3)

### 8.1 Claude Code — PreToolUse guard hook [Claude]
- Một Node script nằm trong plugin. Matcher `Edit|Write`. Hook đọc `file_path` và nội dung mới, áp **pattern cấm theo stack** (ví dụ `JsonNode` / `Map<String, Object>` trong `*.java` thuộc tầng service/domain; `: any` trong `*.ts`).
- Gặp vi phạm thì **chặn**, báo mã rule và cách sửa đúng.
- Lối thoát: comment `stackcrew-allow: <mã> <lý do>` trên dòng đó.
- Chỉ quét **phần nội dung mới**, để không chặn file cũ chỉ vì nó đã sẵn vi phạm.
- Có thể bật/tắt trong `stackcrew.json`. Danh sách pattern cấm sinh từ catalog.

### 8.2 Cấu hình sinh theo stack (L3) [Claude — rule cụ thể do builder chọn]
- **Java/Spring**:
  - Checkstyle/PMD: magic number, độ dài hàm.
  - **ArchUnit test**: cấm `JsonNode`/`Map<String,Object>` trong tầng service/domain, cấm field injection, ràng buộc phân tầng, cấm DTO provider lọt vào domain.
  - Spotless.
- **TypeScript (Nest/Next/React/Angular)**:
  - ESLint flat config: `@typescript-eslint/no-explicit-any`, `no-magic-numbers` (đã chỉnh), `no-restricted-syntax`/`no-restricted-types` cho `Record<string, any>`/`object`.
  - Ràng buộc import giữa các tầng: eslint-plugin-boundaries hoặc dependency-cruiser.
  - **NestJS 10 có thể còn dùng ESLint 8 với `.eslintrc`.** Renderer detect major version của ESLint, sinh flat config cho ESLint ≥ 9 và cấu hình legacy cho ESLint 8. Builder chốt cách làm cụ thể.
- **Go** — golangci-lint:
  - `forbidigo` hoặc `revive` cho `interface{}`/`any` ở type exported;
  - `goconst`, `mnd`, `depguard`.
- Bản đầu, Java chỉ dùng **ArchUnit + Checkstyle**. PMD và Spotless để sau [Claude].
- Lệnh `stackcrew check` quét các dòng được thêm so với base ref bằng bộ pattern cấm của guard hook. Vì vậy nó tự nhiên chỉ chặn trên phần thay đổi, cả với dự án cũ. ArchUnit chạy trong `mvn test` sau khi đã wire.

### 8.3 Gắn vào build và CI [Claude]
- `init`/`sync` **luôn** ghi file cấu hình lint/arch-test và **một stage Jenkins mẫu** [User: Jenkins]: snippet declarative pipeline `stage('stackcrew check')` để dán vào `Jenkinsfile`. Bản đầu không làm GitHub Actions hay GitLab.
- **Không tự sửa `Jenkinsfile` có sẵn.** Chỉ ghi snippet và hướng dẫn.
- **Thêm dependency vào file build** (`pom.xml`, `build.gradle(.kts)`, `package.json`, `go.mod` tools) **chỉ khi người dùng xác nhận** (`--wire`, hoặc agent hỏi trong `init`). Với dự án cũ thì không bao giờ tự sửa file build khi chưa hỏi.
- Dự án mới chưa có file build lúc `init`: hồ sơ ghi lại ý định. Khi file build xuất hiện, `sync` sẽ đề nghị wire.
- Thiếu dependency thì `check` báo rõ cần thêm gì, kèm snippet copy được.

---

## 9. Đóng gói cho từng tool

> Định dạng dưới đây đã kiểm chứng theo tài liệu chính thức ngày 2026-10-24 (code.claude.com, cursor.com/docs, learn.chatgpt.com, antigravity.google/docs).

### 9.1 Sự thật cần biết (đã kiểm chứng)
- **Cursor, Codex và Antigravity đều đọc skill ở `.agents/skills/<name>/SKILL.md`.** Cursor đọc **thêm** `.cursor/skills`, `.claude/skills`, `.codex/skills`. Cursor cũng đọc agent ở `.cursor/agents`, `.claude/agents`, `.codex/agents`. → Nếu ghi cùng một skill hoặc agent vào nhiều thư mục thì **Cursor thấy trùng**.
- **Codex không có rule theo glob.** `.codex/rules` dùng cho quyền chạy lệnh shell, không phải chỉ dẫn. `AGENTS.md` lồng nhau chỉ được nạp nếu Codex khởi động trong thư mục đó. Toàn chuỗi `AGENTS.md` bị giới hạn **32 KiB**.
- **Antigravity**:
  - Rule ở `.agents/rules/*.md` với `trigger: always_on | glob | model_decision | manual`; `globs` là **chuỗi có ngoặc kép, phân cách bằng dấu phẩy**.
  - Chỉ quét file nằm **trực tiếp** trong `rules/`. File thiếu `trigger` hợp lệ **bị bỏ qua mà không báo gì**.
  - Một file rule tối đa 24.000 byte.
  - Antigravity đọc cả `AGENTS.md`.
  - **Workflows đã ngừng hoạt động từ 2026-10-19**, chỉ còn skills.
- **Cursor**:
  - Rule ở `.cursor/rules/**/*.mdc`, frontmatter `description`/`globs`/`alwaysApply`; mỗi rule dưới 500 dòng.
  - Cursor đọc cả `AGENTS.md` (root và lồng nhau).
  - Skill `name` phải trùng tên thư mục.
- Frontmatter skill mà **cả ba tool cùng chấp nhận chắc chắn**: `name` + `description`. Chưa rõ Codex và Antigravity có chấp nhận `paths` hay không.

### 9.2 Ánh xạ [Claude — dựa trên 9.1]
| | Claude Code | Cursor | Codex | Antigravity |
|---|---|---|---|---|
| **Rule lõi always-on** | `.claude/rules/stackcrew/core.md` (không `paths`) | khối stackcrew trong `AGENTS.md` gốc | khối stackcrew trong `AGENTS.md` gốc | khối stackcrew trong `AGENTS.md` gốc |
| **Rule theo stack (glob)** | `.claude/rules/stackcrew/<stack>.md` + `paths:` | `.cursor/rules/stackcrew/<stack>.mdc` + `globs`, `alwaysApply: false` | **Không có glob** → trong khối `AGENTS.md` có mục "luật bắt buộc rút gọn" cho từng stack + skill `stackcrew-<stack>-rules` có description nêu rõ stack | `.agents/rules/stackcrew-<stack>.md` + `trigger: glob` (file phẳng, không thư mục con) |
| **Skill theo việc** (chỉ stack của repo) | `.claude/skills/stackcrew-*/` (có `paths`) | đọc `.claude/skills` hoặc `.agents/skills` (xem lưu ý trùng) | `.agents/skills/stackcrew-*/` | `.agents/skills/stackcrew-*/` |
| **Skill lệnh** (init/sync/check/add-stack) | plugin `skills/` (`/stackcrew:*`) | `.agents/skills/stackcrew-init` (phỏng vấn) | như Cursor | như Cursor |
| **Vai/agent** | `.claude/agents/stackcrew-*.md` + `skills:` | dùng lại `.claude/agents` nếu đã chọn Claude, không thì `.cursor/agents/` | `.codex/agents/stackcrew-*.toml` | `.agents/agents/stackcrew-*.md` + `skills` |
| **Chặn lúc ghi (L2)** | PreToolUse hook trong plugin | bản đầu không có, dựa vào L1 + L3 | bản đầu không có | bản đầu không có |

**Lý do của các lựa chọn chính:**
- **Skill theo stack sinh vào dự án, không ship trong plugin.** NestJS và Next.js cùng là `.ts`, Spring Boot và Quarkus cùng là `.java`, nên `paths` trong plugin không phân biệt được stack. Vì mỗi repo một stack [User], `init` chỉ sinh skill của **đúng stack đó**, nên skill của stack khác không thể fire nhầm. Plugin chỉ mang skill lệnh và guard hook.
- **Tránh Cursor thấy trùng skill** (Cursor đọc cả `.claude/skills` lẫn `.agents/skills`). Renderer tính tập ghi theo tổ hợp tool:
  - chỉ Claude + Cursor → chỉ ghi `.claude/skills/`;
  - có Antigravity mà không có Codex → Antigravity dùng thư mục legacy `.agent/skills/` (Cursor không đọc thư mục này);
  - có cả Claude, Cursor **và** Codex → buộc phải có `.claude/skills/` lẫn `.agents/skills/`. Builder kiểm tra xem Cursor có gộp skill trùng `name` không. Nếu không gộp, ghi nhận là giới hạn đã biết và in cảnh báo.
- **Rule lõi always-on cho Cursor, Codex và Antigravity đặt trong `AGENTS.md`** (cả ba đều đọc). Không tạo thêm `.mdc` `alwaysApply` hay rule `always_on`, để tránh nạp hai lần.
- Khối stackcrew trong `AGENTS.md` giữ **dưới khoảng 16 KB** (5 Essentials bullets per rule when Codex is selected), nhằm chừa chỗ cho nội dung của người dùng hoặc SDLC trong giới hạn 24 KB / 32 KiB.
- Skill trong `.agents/skills/` chỉ dùng `name` + `description` (phần chung chắc chắn). Việc giới hạn theo stack thể hiện bằng **câu chữ của description**.

**Nguyên tắc renderer: mỗi tool thấy mỗi skill/agent đúng một lần.** Renderer tính tập file cần ghi dựa trên **tổ hợp tool đã chọn**, không ghi mù theo từng tool. Có test snapshot cho mọi tổ hợp.

**Cần kiểm chứng khi build** (chưa có tài liệu xác nhận):
- (a) Cursor có gộp hai skill trùng `name` ở `.claude/skills` và `.agents/skills` không? Antigravity có còn đọc `.agent/skills` legacy không?
- (b) Cursor có chấp nhận frontmatter `model: sonnet` của agent Claude không? Nếu không thì tách riêng `.cursor/agents/`.
- (c) Codex và Antigravity có bỏ qua key lạ trong SKILL.md không?
- (d) Khi người dùng **không** cài plugin: skill theo stack vẫn nằm trong dự án; lệnh chạy qua `npx stackcrew`. Chỉ thiếu L2 (guard hook). Cần ghi rõ điều này trong hướng dẫn.

**Quy tắc chung** [Claude]:
- Mọi file stackcrew sinh ra nằm trong thư mục hoặc khu vực có tên `stackcrew`, để `sync` ghi đè an toàn mà không đụng file của người dùng hay của SDLC.
- Với file dùng chung như `AGENTS.md` hay `CLAUDE.md`: chèn hoặc thay **một khối có đánh dấu** `<!-- stackcrew:begin --> … <!-- stackcrew:end -->`. Không append mù như SDLC.
- `CLAUDE.md` chỉ thêm một dòng trỏ tới `.claude/rules/stackcrew/`. Rule thật nằm trong `.claude/rules/`.
- **Manifest** `.stackcrew/manifest.json` lưu đường dẫn và hash của mọi file stackcrew đã ghi.
  - `sync` chỉ xóa file có trong manifest.
  - Thiếu manifest hoặc manifest hỏng thì **không xóa gì**.
  - File sinh ra đã bị sửa tay (hash lệch) thì cảnh báo và từ chối ghi đè, trừ khi có `--force`.

---

## 10. Mở rộng (G6)
- **Thêm stack**: tạo `catalog/stacks/<tên>/` gồm:
  - `stack.json`: tên, category, glob file, tín hiệu detect, alias, mẫu lint, vai tương ứng;
  - `rules.md`, `testing.md`, `skills/*`, `lint/*`.
  CLI tự phát hiện, không sửa lõi.
- **Thêm pattern**: thêm một file trong `catalog/patterns/` theo khuôn §5.3.
- **Rule riêng của công ty hoặc dự án**: đặt trong `.stackcrew/custom/*.md` ở dự án (có frontmatter glob). `sync` render cả phần này ra 4 tool, không cần fork stackcrew.
- **Nâng version stackcrew**: chạy `sync` để render lại. Hồ sơ và `custom/` giữ nguyên.

---

## 11. Rà soát SDLC: lấy gì, bỏ gì, thêm gì
| | Nội dung |
|---|---|
| **Lấy** | `DEV_QUALITY_RULES`, `TECH_STACKS` (12 stack), logic detect/scan, cách sinh plugin bằng lệnh `plugin`, workflow release qua tag |
| **Bỏ** | Trigger pipeline khi nhận ý tưởng, phase banner, auto-advance, feature card, sdlc-config, banner model tier, toàn bộ nội dung PO/BA/Design/Architect/Security/Deploy/Maintenance, living guideline |
| **Thiếu → thêm** | (1) Rule chỉ là tài liệu, chưa phải skill tự kích hoạt → chuyển thành rule native + skill. (2) Chưa có React thuần, Go, Camel, Redis pub/sub, Loki/Grafana. (3) Chưa có rule test riêng theo stack. (4) Pattern mới là danh sách GoF chung → guide có tín hiệu, "không dùng khi" và idiom theo ngôn ngữ. (5) Chưa có bước chọn kiến trúc và pattern theo bối cảnh dự án. (6) Vai dev còn chung chung → vai theo stack. (7) Chưa có lưới chặn (hook, lint, ArchUnit). (8) Chưa có các luật SC-TYPE, SC-CONST, SC-REUSE người dùng nêu. (9) Ghi khối có đánh dấu thay vì append mù |

---

## 12. Phối hợp với superpowers và các plugin khác
- superpowers brainstorm và viết plan, rồi `subagent-driven-development` giao cho subagent implementer.
- Implementer là subagent general-purpose, nên **nhận CLAUDE.md và `.claude/rules/`**. Khi đụng file khớp glob, rule của stack tự nạp, rồi agent làm pre-flight (§7.2) và gọi skill theo việc nếu khớp.
- stackcrew **không** có skill nào cạnh tranh với brainstorming, writing-plans hay executing-plans.
- Nếu SDLC cũng được cài: stackcrew không đọc và không ghi gì của SDLC. Hai bên chỉ cùng chạm `CLAUDE.md`/`AGENTS.md`, và stackcrew chỉ sửa khối có đánh dấu của mình.

---

## 13. Kiểm chứng (định nghĩa "chạy đúng")
**Dự án mẫu** trong `fixtures/` (dùng xong bỏ, dựng mới mỗi lần kiểm):
1. **Spring Boot 3**. Chạy `init` với bối cảnh "tích hợp eKYC nhiều provider", rồi giao task "thêm provider C06". Kỳ vọng:
   - có port + Adapter cho C06, đăng ký vào registry Strategy/Factory, dùng khung Template Method chung;
   - có ACL, không để DTO của provider lọt vào domain;
   - DTO rõ ràng, không `JsonNode`/`Map`; có constant; tái sử dụng util có sẵn;
   - log có traceId; có circuit breaker;
   - có test WireMock;
   - có ghi chú pre-flight trước khi code.
2. **NestJS 10**. Task "consumer Kafka cho `kyc.completed`". Kỳ vọng:
   - consumer idempotent, có DLQ;
   - event có type/schema rõ ràng;
   - không `any`.
3. **Next.js 16**. Task "form đăng ký eKYC + server action". Kỳ vọng:
   - schema zod, type suy ra từ schema;
   - server action có validate và kiểm quyền;
   - không `any`, có constant;
   - có đủ trạng thái loading/empty/error.
4. **Quarkus, Go, React, Angular**: kiểm bằng snapshot render và lint với vi phạm cài sẵn. Golden task cho các stack này là tùy chọn trong bản đầu [Claude].

**Kiểm cơ chế:**
- Mỗi cấu hình lint/ArchUnit/golangci **fail** trên file mẫu cố tình vi phạm (`Map<String,Object>`, `any`, magic string).
- Guard hook **chặn** lệnh Write có cấu trúc cấm, và **cho qua** khi có `stackcrew-allow`.
- **Phối hợp superpowers:** chạy writing-plans rồi subagent-driven-development trên fixture 1, xác nhận:
  - (a) subagent implementer thật sự nhận rule (câu hỏi mở từ §12);
  - (b) code đạt kỳ vọng;
  - (c) stackcrew **không** kích hoạt quy trình nào.
- **Không fire bừa:** gõ một prompt chung chung ("build me a todo app") thì không skill stackcrew nào được gọi, chỉ rule always-on có mặt.
- **Đủ 4 tool:** file sinh ra đúng định dạng native. Cursor, Codex và Antigravity kiểm bằng smoke test tay theo checklist. Riêng Antigravity: kiểm rule glob **thật sự được nạp**, vì file sai `trigger` bị bỏ qua mà không báo.
- **Không trùng lặp:** với mọi tổ hợp tool, Cursor liệt kê mỗi skill/agent stackcrew đúng một lần. Khối `AGENTS.md` dưới ngân sách kích thước.
- **Codex không có glob:** trên fixture 1, giao task Java cho Codex, xác nhận agent áp dụng luật rút gọn trong `AGENTS.md` và gọi skill `stackcrew-spring-boot-rules`.
- **Test tự động của chính repo stackcrew** (node:test): render ra snapshot, lint `description` của skill (§7.3), validate frontmatter.
- **Ai chạy smoke test tay** [Claude]: Claude Code do agent tự chạy. Cursor, Codex và Antigravity: plan kết thúc bằng một checklist bàn giao cho người dùng chạy. **Chỉ `npm publish` sau khi người dùng xác nhận checklist đạt.**

---

## 14. Các quyết định và người quyết
**Người dùng đã quyết:**
- tách hẳn khỏi SDLC; chỉ có dev và testing; tên `stackcrew`, đặt cạnh `SDLC/`;
- 4 tool;
- phòng là chính, lint là lưới chặn cuối;
- 7 stack: Spring Boot, Quarkus, NestJS, Next.js, Go, React, Angular; **mỗi repo một stack**;
- version thấp nhất: Spring Boot 3.x, Next.js 16, NestJS 10; CI là Jenkins;
- các luật SC-TYPE, SC-CONST, SC-REUSE;
- danh sách pattern; Camel/Kafka/pub-sub; Loki/Grafana;
- gợi ý ở cả hai thời điểm: setup và khi nhận task.

**Claude tự quyết (có thể bác):**
- npm CLI + Claude plugin; nội dung nằm trong `catalog/` thay vì dồn vào cli.js;
- rule tiếng Anh, hướng dẫn tiếng Việt;
- hỗ trợ cả dự án mới lẫn dự án cũ (chỉ chặn trên phần thay đổi);
- Camel chỉ cho JVM, Node/Go có phương án tương đương;
- PreToolUse guard hook;
- phỏng vấn do agent làm, render do CLI làm;
- agent vai **và skill theo stack** sinh vào dự án; plugin chỉ mang skill lệnh và hook; hồ sơ kiến trúc 2 file;
- DTO Java ưu tiên `record`, Lombok `@Builder` cho class nhiều field tùy chọn;
- vai chỉ chạy khi được gọi tên; quyết định lệch hồ sơ thì hỏi người dùng;
- không tự sửa file build hay `Jenkinsfile` khi chưa xác nhận;
- version cho Quarkus, Angular, React, Go (§3);
- smoke test Cursor, Codex, Antigravity do người dùng chạy trước khi publish;
- ghi khối có đánh dấu;
- bản đầu chưa sinh khung ứng dụng và chưa có dashboard JSON.

**Đoán:**
- Go dùng `net/http` + chi;
- "pub/sub" là RabbitMQ/Redis/cloud;
- Tempo/Prometheus;
- agent code tiếp sau pre-flight, chỉ dừng khi có quyết định lớn.

## 15. Để builder tự quyết
- Tên lệnh, cờ và tên file cụ thể.
- Bộ rule lint chi tiết.
- Câu chữ của guide và ví dụ code.
- Thư viện cụ thể cho Node/Go (resilience, queue).
- Cấu trúc nội bộ `src/`.
- Thứ tự port các stack.
- Cách diff-lint cụ thể cho ESLint.
