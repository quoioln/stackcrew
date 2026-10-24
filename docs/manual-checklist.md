# Checklist kiểm tay (bàn giao cho Plan 3)

Mục đích: những thứ test tự động không chứng minh được (hành vi thật của Cursor, Codex, Antigravity, Claude Code). Tham chiếu: spec §9.2 và §13.

**Chuẩn bị chung**

1. Copy `fixtures/spring-boot-minimal/` ra thư mục tạm, chạy `git init -b main`.
2. Chạy `node <repo>/bin/stackcrew.js init --stack spring-boot --addons kafka,camel,observability --tools claude,cursor,codex,antigravity`.
3. Mở thư mục đó trong tool cần kiểm. Ghi kết quả vào cột "Kết quả" (đạt / hỏng + ghi chú).

## Cursor

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| C1 | Mở `BadService.java`, xem rule đang áp dụng | Các rule `.cursor/rules/stackcrew/*.mdc` gắn vào file `*.java` (core, lang-java, stack-spring-boot) | |
| C2 | Liệt kê skill trong Settings | Mỗi skill stackcrew hiện **một lần**, hoặc có đúng cảnh báo `cursor-duplicate-skills` (Cursor đọc cả `.claude/skills` và `.agents/skills`) | |
| C3 | Liệt kê agent | Agent stackcrew được đọc từ `.claude/agents`, hiện đúng một lần | |
| C4 | Mở một agent có `model: sonnet/opus/haiku` | Cursor chấp nhận trường `model` (spec §9.2 b), không báo lỗi frontmatter | |
| C5 | Nhờ agent thêm field `Map<String, Object>` vào service | Agent từ chối hoặc dùng record, nhắc rule SC-TYPE | |

## Codex

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| X1 | Hỏi Codex "bạn đang áp dụng quy tắc nào" | Trả lời dựa trên các Essentials trong khối stackcrew của `AGENTS.md` | |
| X2 | Giao task Java (ví dụ thêm provider) | Codex gọi skill `stackcrew-spring-boot-rules` để đọc phần rule đầy đủ | |
| X3 | Kiểm tra `.codex/agents/stackcrew-*.toml` | Agent được nạp, không báo lỗi parse | |
| X4 | Skill có khóa lạ trong `SKILL.md` | Codex bỏ qua khóa lạ, vẫn nạp skill (spec §9.2 c) | |

## Antigravity

| # | Bước | Kỳ vọng | Kết quả |
| --- | --- | --- | --- |
| A1 | Mở `BadService.java`, xem rule nào đang nạp | Rule glob trong `.agents/rules/stackcrew-*.md` **thật sự được nạp** (file có `trigger` sai bị bỏ qua mà không báo, nên phải kiểm bằng mắt) | |
| A2 | Mở một file không phải Java | Rule `lang-java` và `stack-spring-boot` không nạp | |
| A3 | Liệt kê skill | Skill trong `.agents/skills/stackcrew-*` hiện đủ | |
| A4 | Khóa lạ trong `SKILL.md` | Antigravity bỏ qua khóa lạ, vẫn nạp skill (spec §9.2 c) | |

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
3. `mvn -q test`: **đạt**, thư mục `archunit_store/` được tạo (ghi lại vi phạm có sẵn của `BadService`).
4. Thêm `src/main/java/com/example/kyc/service/BadService2.java` có field `Map<String, Object>`.
5. `mvn -q test` lần nữa: **fail**, thông báo ArchUnit nêu `BadService2`.

Kết quả: **đạt** (Maven 3.9.12, JDK 21.0.9 Corretto, Spring Boot 3.5.11 / surefire 3.5.4).

- Lần 1: `Tests run: 4, Failures: 0`, `BUILD SUCCESS`, `archunit_store/` có 4 file rule và `stored.rules`.
- Lần 2: `Tests run: 4, Failures: 1`, `com.example.kyc.service.BadService2.data has field type java.util.Map<java.lang.String, java.lang.Object> (SC-TYPE)`.

**Cảnh báo bắt buộc kiểm:** với Spring Boot 3.4.x đến 3.5.4 (surefire 3.5.3), `mvn test` báo `Tests run: 0` và build xanh, ArchUnit **không chạy**. Mọi lần kiểm Maven phải thấy `Tests run: 4` (hoặc nhiều hơn) trong log; nếu thấy 0 thì nâng surefire lên >= 3.5.4. Plan 3 cần quyết định `--wire` có tự đặt `maven-surefire-plugin.version` hay chỉ cảnh báo.

## Ký xác nhận

Chỉ chạy `npm publish` sau khi người dùng xác nhận các mục trên đã đạt.

- Người xác nhận: ______  Ngày: ______
