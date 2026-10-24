# Checklist kiểm tay (bàn giao cho Plan 3)

Mục đích: những thứ test tự động không chứng minh được (hành vi thật của Cursor, Codex, Antigravity, Claude Code). Tham chiếu: spec §9.2 và §13.

**Chuẩn bị chung**

1. Copy `fixtures/spring-boot-minimal/` ra thư mục tạm, chạy `git init -b main`.
2. Chạy `node <repo>/bin/stackcrew.js init --stack spring-boot --addons kafka,camel,observability --tools claude,cursor,codex,antigravity`.
3. Mở thư mục đó trong tool cần kiểm. Ghi kết quả vào cột "Kết quả" (đạt / hỏng + ghi chú).

## Cursor

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| C1 | Mở `BadService.java`. Xem Cursor Settings > Rules (mục Project Rules) và chỉ báo rule ở đầu khung chat. Rồi hỏi agent: "which rules apply to this file?" | Các rule `.cursor/rules/stackcrew/*.mdc` (core, lang-java, stack-spring-boot) hiện là Project Rules, và agent liệt kê chúng khi đang mở file `*.java`. Mở một file không phải Java thì rule theo glob không được liệt kê | |
| C2 | Liệt kê skill trong Settings | Mỗi skill stackcrew hiện **một lần**, hoặc có đúng cảnh báo `cursor-duplicate-skills` (Cursor đọc cả `.claude/skills` và `.agents/skills`) | |
| C3 | Liệt kê agent | Agent stackcrew được đọc từ `.claude/agents`, hiện đúng một lần | |
| C4 | Mở một agent có `model: sonnet/opus/haiku` | Cursor chấp nhận trường `model` (spec §9.2 b), không báo lỗi frontmatter | |
| C5 | Nhờ agent thêm field `Map<String, Object>` vào service | Agent từ chối hoặc dùng record, nhắc rule SC-TYPE | |

## Codex

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| X1 | Hỏi Codex "bạn đang áp dụng quy tắc nào" | Trả lời dựa trên các Essentials trong khối stackcrew của `AGENTS.md` | |
| X1b | Đo khối stackcrew trong `AGENTS.md` (từ `<!-- stackcrew:begin` đến `<!-- stackcrew:end -->`) và xem output của `init`/`sync` | Khối <= 16.000 byte, không có cảnh báo `agents-md-essentials-reduced` | |
| X2 | Giao task Java (ví dụ thêm provider) | Codex gọi skill `stackcrew-spring-boot-rules` để đọc phần rule đầy đủ | |
| X3 | Kiểm tra `.codex/agents/stackcrew-*.toml` | Agent được nạp, không báo lỗi parse | |
| X4 | Thêm một khóa hoàn toàn không chuẩn: dòng `stackcrew_probe: 1` vào frontmatter của `.agents/skills/stackcrew-spring-integration-provider/SKILL.md`, mở lại Codex | Codex vẫn liệt kê skill này, không báo lỗi; khóa lạ `stackcrew_probe` bị bỏ qua (spec §9.2 c) | |

## Antigravity

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| A1 | Mở `BadService.java`. Vào panel Rules của Antigravity (Customizations > Rules) để xem danh sách, rồi hỏi agent: "which rules apply to this file?" | Rule glob trong `.agents/rules/stackcrew-*.md` **thật sự được nạp**: có trong panel và agent nêu được nội dung của chúng. File có `trigger` sai bị bỏ qua mà không báo, nên phải chứng minh bằng câu hỏi này | |
| A2 | Mở một file không phải Java | Rule `lang-java` và `stack-spring-boot` không nạp | |
| A3 | Liệt kê skill | Skill trong `.agents/skills/stackcrew-*` hiện đủ | |
| A4 | Thêm một khóa hoàn toàn không chuẩn: dòng `stackcrew_probe: 1` vào frontmatter của `.agents/skills/stackcrew-spring-integration-provider/SKILL.md` | Antigravity vẫn liệt kê skill, bỏ qua khóa lạ (spec §9.2 c) | |

## Claude Code

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| L1 | Chạy `claude plugin validate ./plugin` | Đạt | |
| L2 | `/plugin marketplace add <repo>` rồi `/plugin install stackcrew@stackcrew` | Cài được, thấy `/stackcrew:init`, `/stackcrew:sync`, `/stackcrew:add`, `/stackcrew:check` | |
| L3 | Chạy `/stackcrew:init` trên thư mục trống | Agent chạy phỏng vấn, ghi `stackcrew.json`, render file | |
| L4 | Nhờ Claude ghi file có `private Map<String, Object> x;` (Write) | Guard chặn, thông báo nêu `SC-TYPE` | |
| L5 | Ghi lại dòng đó kèm `// stackcrew-allow: SC-TYPE <lý do>` | Cho qua | |
| L6 | Chạy superpowers `subagent-driven-development` trên fixture | Subagent implementer **nhận rule** của stack khi đụng file `*.java` (câu hỏi mở spec §12), và stackcrew không kích hoạt quy trình nào | |
| L7 | Gõ prompt chung chung ("build me a todo app") | Không skill stackcrew nào được gọi, chỉ có rule always-on | |

## Golden task (spec §13)

Trên fixture Spring Boot, bối cảnh "tích hợp eKYC nhiều provider", giao task **"thêm provider C06"**. Kỳ vọng:

- [ ] Có port và Adapter cho C06, đăng ký vào registry Strategy/Factory, dùng khung Template Method chung.
- [ ] Có ACL, DTO của provider không lọt vào domain.
- [ ] DTO rõ ràng (record), không `JsonNode`/`Map<String, Object>`; có constant; tái sử dụng util có sẵn.
- [ ] Log có traceId; có circuit breaker.
- [ ] Có test WireMock.
- [ ] Có ghi chú pre-flight trước khi code.

Kết quả (từng tool: Claude Code, Cursor, Codex, Antigravity): ______

## Maven / ArchUnit

Quy trình (đã chạy ngày 2026-10-24, kết quả bên dưới):

1. Copy fixture ra thư mục tạm, `git init`.
2. `node <repo>/bin/stackcrew.js init --stack spring-boot --tools claude --wire`.
3. `mvn test` (không dùng `-q`, để thấy `Tests run: N`; hoặc xem `target/surefire-reports`): **đạt**, thư mục `archunit_store/` được tạo (ghi lại vi phạm có sẵn của `BadService`).
4. Thêm `src/main/java/com/example/kyc/service/BadService2.java` có field `Map<String, Object>`.
5. `mvn test` lần nữa: **fail**, thông báo ArchUnit nêu `BadService2`.

Kết quả: **đạt** (Maven 3.9.12, JDK 21.0.9 Corretto). Chạy lại ngày 2026-10-24 (Task 22b) trên bản sao fixture, chỉ đổi phiên bản parent Spring Boot:

| Spring Boot | surefire | Lần 1 (store mới) | Lần 2 (+ `BadService2`) |
|---|---|---|---|
| 3.2.12 | 3.1.2 | `Tests run: 5, Failures: 0`, BUILD SUCCESS | `Tests run: 5, Failures: 1`, exit 1 |
| 3.3.13 | 3.2.5 | `Tests run: 5, Failures: 0`, BUILD SUCCESS | `Tests run: 5, Failures: 1`, exit 1 |
| 3.4.9 | 3.5.3 | `Tests run: 5, Failures: 0`, BUILD SUCCESS | `Tests run: 5, Failures: 1`, exit 1 |
| 3.5.4 | 3.5.3 | `Tests run: 5, Failures: 0`, BUILD SUCCESS | `Tests run: 5, Failures: 1`, exit 1 |
| 3.5.11 | 3.5.4 | `Tests run: 5, Failures: 0`, BUILD SUCCESS | `Tests run: 5, Failures: 1`, exit 1 |
| 3.4.9 (Gradle 8.14.4) | — | `tests="5" failures="0"`, exit 0 | `tests="5" failures="1"`, exit 1 |

- Lần 1: `archunit_store/` có 4 file rule và `stored.rules`.
- Lần 2: thông báo nêu `com.example.kyc.service.BadService2.data has field type java.util.Map<java.lang.String, java.lang.Object> (SC-TYPE)`; vi phạm có sẵn của `BadService` không bị báo.

**Bắt buộc kiểm:** log phải có `Tests run: 5` (Gradle: `build/test-results/test/TEST-*.xml` có `tests="5"`). Nếu thấy `Tests run: 0` hoặc ít hơn 5, gate ArchUnit không hoạt động. Khi đó kiểm tra `StackcrewArchitectureTest` có bị sửa tay về dạng field `static final ArchRule` không (surefire 3.5.3 bỏ kết quả của rule dạng field), và với Gradle, task `test` có `useJUnitPlatform()` không.

## Ký xác nhận

Chỉ chạy `npm publish` sau khi người dùng xác nhận các mục trên đã đạt.

- Người xác nhận: ______  Ngày: ______
