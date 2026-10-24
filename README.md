# stackcrew

## Giới thiệu / mục đích

stackcrew là một CLI không phụ thuộc thư viện ngoài (zero-dependency, Node.js >= 18.3) kèm một plugin Claude Code. Nó ghi vào dự án của bạn:

- **Rule** về coding standard (type safety, error handling, logging, security, testing, performance, brownfield, delivery) cộng với rule riêng của từng stack và add-on.
- **Skill theo từng việc** của stack (ví dụ thêm REST endpoint, thêm provider tích hợp, consumer Kafka, viết test), mô tả hẹp để không tự gọi bừa.
- **Vai (agent)**: `tech-lead`, `developer`, `tester`.
- **Lưới chặn**: guard hook lúc ghi file (Claude Code), lệnh `check` dựa trên diff cho Jenkins, cấu hình Checkstyle và test ArchUnit sinh sẵn.

Tool được hỗ trợ: Claude Code, Cursor, Codex, Antigravity. Mỗi tool nhận file đúng định dạng native của nó.

Ba lớp phòng thủ (spec §8):

1. **L1, lời dặn**: rule always-on, rule theo glob, skill, agent.
2. **L2, chặn lúc ghi**: PreToolUse guard hook, chỉ có trên Claude Code.
3. **L3, chặn lúc build và CI**: ArchUnit (đã đóng băng bằng `FreezingArchRule`), Checkstyle, `stackcrew check` trong Jenkins.

Plan 1 chỉ hỗ trợ stack **Spring Boot 3.x (Java 17+)** với add-on `kafka`, `rabbitmq`, `camel`, `observability`.

## Không làm gì

- **Không điều phối** (no orchestration): không tự chuyển bước, không có pipeline, không có "khi người dùng gửi ý tưởng thì chạy quy trình".
- **Không phải quy trình SDLC**: không có PO/BA/Architect, không có phase. stackcrew không đọc và không ghi gì của SDLC (không bao giờ ghi vào `docs/sdlc/`).
- Không sửa `Jenkinsfile` có sẵn, không sửa `pom.xml` / `build.gradle(.kts)` nếu bạn không truyền `--wire`.
- Không đụng văn bản ngoài khối `<!-- stackcrew:begin -->` ... `<!-- stackcrew:end -->` trong `CLAUDE.md` và `AGENTS.md`.

## Cài đặt

**npm** (không cần cài global):

```bash
npx stackcrew init --stack spring-boot
```

**Plugin Claude Code**:

```text
/plugin marketplace add <đường-dẫn-repo-hoặc-url>
/plugin install stackcrew@stackcrew
```

Plugin có sẵn bản CLI đi kèm (`plugin/cli`), các lệnh `/stackcrew:init`, `/stackcrew:sync`, `/stackcrew:add`, `/stackcrew:check` và guard hook.

## Bắt đầu nhanh

Trong Claude Code, chạy `/stackcrew:init`: agent phỏng vấn kiến trúc (bối cảnh, quyết định), rồi ghi `stackcrew.json` và render file.

Hoặc dùng CLI trực tiếp:

```bash
npx stackcrew init --stack spring-boot --tools claude,cursor,codex,antigravity
```

Thêm add-on:

```bash
npx stackcrew init --stack spring-boot --addons kafka,camel,observability --tools claude
```

Sau `init`:

- `stackcrew.json` là profile (nguồn sự thật). Sửa nó rồi chạy `stackcrew sync`.
- `docs/stackcrew/architecture-profile.md` là bản đọc được của profile.
- Với tool không phải Claude, nhờ agent dùng skill `stackcrew-init` để chạy phỏng vấn.
- Dự án Java chưa nối ArchUnit sẽ nhận gợi ý chạy `stackcrew sync --wire`.

## Các lệnh

Mã thoát: `0` thành công, `1` lỗi hoặc có vi phạm, `2` (chỉ riêng `check`) không chạy được.

| Lệnh | Tác dụng | Cờ |
| --- | --- | --- |
| `init` | Tạo `stackcrew.json` rồi render | `--stack <id>`, `--addons a,b`, `--tools claude,cursor,codex,antigravity`, `--wire`, `--force`, `--no-guard` |
| `sync` | Render lại từ profile | `--force`, `--wire`, `--dry-run` |
| `add <addon...>` | Thêm add-on vào profile rồi sync | không có |
| `list` | Liệt kê stack và add-on | không có |
| `detect` | Phát hiện stack, add-on, chế độ greenfield/brownfield, `basePackage` | không có |
| `check` | Quét các dòng thêm vào theo luật guard | `--base <ref>`, `--staged` |
| `plugin` | Sinh lại plugin Claude Code (`plugin/`, `.claude-plugin/`) | không có |
| `version`, `help` | In phiên bản, in trợ giúp | không có |

Chi tiết:

- `init` không có `--stack`: dùng stack phát hiện được; nếu không có và đang ở terminal thì hiện menu chọn. Nếu `stackcrew.json` đã có, `init` từ chối (exit 1) trừ khi có `--force`; `--force` giữ lại `decisions`, `context` và cài đặt `java`.
- `sync` chỉ tạo, ghi đè hoặc xóa file nằm trong danh sách file do stackcrew sở hữu (ghi trong `.stackcrew/manifest.json`). File sinh ra mà bạn sửa tay sẽ **không bị ghi đè**: được báo, lệnh thoát với exit 1. Dùng `--force` để ghi đè, hoặc chuyển phần sửa sang `.stackcrew/custom/`.
- `--wire` (Java): thêm `archunit-junit5` (test scope) vào `pom.xml` / `build.gradle(.kts)` và sinh `src/test/java/<basePackage>/stackcrew/StackcrewArchitectureTest.java`.
  Lưu ý: với Maven + Spring Boot 3.4.x đến 3.5.4, surefire 3.5.3 không chạy test ArchUnit (xem "Giới hạn hiện tại"). Gradle không bị ảnh hưởng theo hiểu biết hiện tại, nhưng chưa được kiểm chứng. Bản cập nhật engine sắp tới sẽ cho `--wire` xử lý phiên bản surefire.
- `check` thoát `0` khi sạch, `1` khi có vi phạm, `2` khi không chạy được (ngoài git repo, thiếu base ref, thiếu `.stackcrew/guard.json`). Nó không bao giờ in "0 violations" khi không chạy được. Không có cờ nào thì quét thay đổi so với `HEAD` kèm file chưa theo dõi.

## Jenkins

`init`/`sync` sinh đoạn stage tại `.stackcrew/ci/Jenkinsfile.stackcrew.groovy`:

```groovy
stage('stackcrew check') {
  steps {
    sh 'npx --yes stackcrew@<version> check --base "origin/${CHANGE_TARGET:-main}"'
  }
}
```

Dán stage này vào `Jenkinsfile` của bạn (stackcrew không bao giờ sửa `Jenkinsfile`). Với clone nông (shallow) hoặc multibranch, **phải fetch nhánh đích trước** (`git fetch origin <target-branch>`), nếu không `check` thoát `2` với thông báo rõ ràng.

## Guard hook và `stackcrew-allow`

Plugin Claude Code cài hook PreToolUse cho `Write`, `Edit`, `MultiEdit`. Hook đọc `.stackcrew/guard.json`, chỉ xét các dòng **mới thêm**, bỏ qua dòng `import` và dòng comment, và chặn (exit 2) khi dòng khớp luật (ví dụ `private Map<String, Object> payload;` hay `private JsonNode raw;`).

Hook fail-open: stdin hỏng, file ngoài dự án, không có `.stackcrew/guard.json`, hoặc `enabled: false` thì cho qua. Tắt guard bằng `init --no-guard`.

Ngoại lệ có lý do, viết **trên cùng dòng** đó:

```java
private Map<String, Object> config; // stackcrew-allow: SC-TYPE Kafka client config bắt buộc kiểu này
```

Dạng bắt buộc: `stackcrew-allow: <rule-id> <reason>`. Thiếu lý do thì không có hiệu lực. `check` trong CI cũng tôn trọng marker này.

## Rule riêng

Đặt file `.stackcrew/custom/<tên>.md` có frontmatter:

```markdown
---
title: Quy ước đặt tên module thanh toán
globs: ["src/main/java/**/payment/**"]
alwaysOn: false
---
## Essentials
- ...
```

- `title`: tiêu đề rule.
- `globs`: file nào thì rule được nạp (Cursor, Antigravity, Claude).
- `alwaysOn: true`: nạp mọi lúc (giữ ngắn, vì chiếm ngân sách).

Chạy `stackcrew sync` để render. Mỗi rule có phần `## Essentials` tối đa 15 gạch đầu dòng.

## Dùng cùng superpowers

- superpowers lo brainstorm, writing-plans, `subagent-driven-development`. stackcrew không có skill nào cạnh tranh với chúng.
- Subagent implementer (general-purpose) nhận `CLAUDE.md` và `.claude/rules/`, nên khi đụng file khớp glob thì rule của stack tự nạp, agent làm pre-flight rồi gọi skill theo việc nếu khớp.
- Nếu SDLC workflow cũng được cài: hai bên chỉ cùng chạm `CLAUDE.md`/`AGENTS.md`, và stackcrew chỉ sửa khối có đánh dấu của mình; phần `## SDLC Workflow` giữ nguyên từng byte (kể cả CRLF).

## Giới hạn hiện tại

- Plan 1 chỉ có **Spring Boot**. Các stack khác nằm ở Plan 2.
- Khi chọn đồng thời `claude`, `cursor` và `codex`, Cursor đọc cả `.claude/skills` lẫn `.agents/skills` nên skill có thể hiện **hai lần**. `sync` in cảnh báo `cursor-duplicate-skills`.
- Guard hook lúc ghi (L2) **chỉ có trên Claude Code**. Tool khác chỉ có L1 (rule) và L3 (build, CI).
- `.stackcrew/lint/checkstyle.xml` được sinh nhưng **chưa nối** vào build: thêm `maven-checkstyle-plugin` (hoặc plugin checkstyle của Gradle) trỏ vào file đó.
- ArchUnit dùng `FreezingArchRule`: lần chạy test đầu tiên ghi vi phạm hiện có vào thư mục `archunit_store/`. **Phải commit `archunit_store/`**; từ đó chỉ vi phạm mới làm test fail.
- Surefire 3.5.3 (Spring Boot 3.4.x đến 3.5.4 khóa phiên bản này) không chạy test ArchUnit: báo `Tests run: 0` mà build vẫn xanh. Dùng Spring Boot 3.5.5 trở lên hoặc đặt `<maven-surefire-plugin.version>3.5.4</maven-surefire-plugin.version>`, rồi kiểm tra log có `Tests run: 4`.
- Codex không có glob nên `AGENTS.md` chỉ chứa các Essentials rút gọn (tối đa 5 mục mỗi rule, tự giảm 5 → 3 → 1 kèm cảnh báo `agents-md-essentials-reduced` nếu vượt ngân sách 16.000 byte); phần đầy đủ nằm trong skill `stackcrew-spring-boot-rules`.

## Phát triển

```bash
npm test                     # node --test, không cần cài dependency
node bin/stackcrew.js plugin # sinh lại plugin/ và .claude-plugin/ sau khi đổi catalog/, src/ hoặc bin/
```

- `test/plugin-drift.test.js` sẽ fail nếu quên chạy `plugin` sau khi sửa.
- `fixtures/spring-boot-minimal/` là dự án mẫu cho `test/e2e.test.js` (có vi phạm cài sẵn trong `BadService`). Nó không nằm trong gói npm.
- Danh sách kiểm thử tay trên Cursor, Codex, Antigravity: xem `docs/manual-checklist.md`.
