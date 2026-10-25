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

**CLI**: stackcrew **chưa publish lên npm** (việc của Plan 3), nên `npx stackcrew` hiện báo 404. Trong lúc chờ, chạy CLI thẳng từ repo GitHub (máy cần quyền đọc repo `quoioln/stackcrew`):

```bash
npx --yes github:quoioln/stackcrew init --stack spring-boot
```

Hoặc từ bản clone: `node <đường-dẫn-repo-stackcrew>/bin/stackcrew.js <lệnh>`. Sau khi publish, dùng `npx stackcrew <lệnh>`. Trong README, `stackcrew <lệnh>` là cách viết tắt cho các cách chạy này.

**Plugin Claude Code**: gồm các lệnh `/stackcrew:init`, `/stackcrew:sync`, `/stackcrew:add`, `/stackcrew:check`, guard hook và bản CLI đi kèm (`plugin/cli`), nên không cần npm.

```bash
claude plugin marketplace add quoioln/stackcrew
claude plugin install stackcrew@stackcrew
```

Scope, cài cho cả team, cập nhật và các lệnh trong phiên: xem "Dùng với Claude Code".

## Bắt đầu nhanh

Với Claude Code đã cài plugin: mở Claude Code ở thư mục gốc dự án (`claude`) rồi gõ `/stackcrew:init`. Agent phỏng vấn kiến trúc từng câu một (bối cảnh, quyết định), đề xuất, chờ bạn duyệt, rồi ghi `stackcrew.json` và render file.

Hoặc dùng CLI trực tiếp:

```bash
npx --yes github:quoioln/stackcrew init --stack spring-boot --tools claude,cursor,codex,antigravity
```

Thêm add-on:

```bash
npx --yes github:quoioln/stackcrew init --stack spring-boot --addons kafka,camel,observability --tools claude
```

Sau `init`:

- `stackcrew.json` là profile (nguồn sự thật). Sửa nó rồi chạy `stackcrew sync`.
- `docs/stackcrew/architecture-profile.md` là bản đọc được của profile.
- Với tool không phải Claude, nhờ agent dùng skill `stackcrew-init` để chạy phỏng vấn.
- Dự án Java chưa nối ArchUnit sẽ nhận gợi ý chạy `stackcrew sync --wire`.

### Dùng Claude Code mà không cài plugin

Chỉ chạy CLI (`stackcrew init --tools claude`) mà không cài plugin thì Claude Code vẫn nhận rule (`.claude/rules/stackcrew/`), skill theo việc và agent. Bạn **mất**: các lệnh `/stackcrew:*`, buổi phỏng vấn kiến trúc `/stackcrew:init` (không có skill phỏng vấn trong dự án) và guard hook lúc ghi (L2). L1 (rule) và L3 (ArchUnit, `check`) vẫn chạy bình thường. Muốn đủ bộ, cài plugin (xem "Dùng với Claude Code").

### Commit những gì

Nên commit:

- `stackcrew.json` (profile, nguồn sự thật).
- `.stackcrew/`: `guard.json` (cần cho `check` trên Jenkins), `manifest.json` (để `sync` biết file nào của stackcrew), `lint/`, `ci/`; kèm `.stackcrew/custom/` nếu bạn có rule riêng.
- Các thư mục rule, skill, agent đã sinh ra (`.claude/`, `.cursor/`, `.agents/`, `.agent/`, `.codex/` theo tool bạn chọn) cùng `AGENTS.md` / `CLAUDE.md`.
- `docs/stackcrew/`.
- `archunit_store/` khi đã `--wire` (bắt buộc, xem "Giới hạn hiện tại"), cùng `StackcrewArchitectureTest.java`.
- `.claude/settings.json` nếu bật plugin ở project scope (xem "Cài cho cả team").

Lưu ý: nếu repo chưa có `CLAUDE.md`, `.claude/CLAUDE.md` hay `CLAUDE.local.md` mà đã có `AGENTS.md` chứa quy ước của team, việc `init`/`sync` tạo `CLAUDE.md` khiến Claude Code bản mới **ngừng đọc** `AGENTS.md` (mặc định `claude-md-or-agents-md`). `sync` in cảnh báo `claude-md-shadows-agents-md`; stackcrew **không** tự thêm `@AGENTS.md` vào `CLAUDE.md` (tránh nạp rule của chính nó hai lần). Muốn dùng cả hai, tự thêm dòng `@AGENTS.md` vào `CLAUDE.md`.

## Dùng với Claude Code

Plugin `stackcrew@stackcrew` nằm trong marketplace `stackcrew` của repo `quoioln/stackcrew` (file `.claude-plugin/marketplace.json`).

### Cài từ terminal (Claude CLI)

```bash
# 1. Thêm marketplace. Claude Code clone repo bằng git của máy bạn: repo private thì cần quyền đọc (SSH hoặc HTTPS).
claude plugin marketplace add quoioln/stackcrew

# 2. Cài plugin. Mặc định là user scope: dùng được ở mọi dự án trên máy bạn.
claude plugin install stackcrew@stackcrew

# 3. Kiểm tra
claude plugin list
claude plugin details stackcrew@stackcrew
```

`details` phải in `Skills (4)  add, check, init, sync` và `Hooks (1)  PreToolUse`. Nếu đang mở sẵn một phiên Claude Code, gõ `/reload-plugins` để nạp plugin mà không cần khởi động lại.

Mỗi tên marketplace chỉ có một nguồn: chạy `claude plugin marketplace add` với nguồn khác (đường dẫn local, URL git) sẽ **thay** nguồn của marketplace `stackcrew` cho mọi plugin đã cài từ nó. Muốn quay lại thì chạy lại `claude plugin marketplace add quoioln/stackcrew`.

### Cài ngay trong phiên Claude Code

```text
/plugin marketplace add quoioln/stackcrew
/plugin install stackcrew@stackcrew
/reload-plugins
```

Hoặc gõ `/plugin` để chọn trong giao diện.

### Chọn scope

| Scope | Cờ | Ghi vào | Khi nào dùng |
| --- | --- | --- | --- |
| user (mặc định) | không có | `~/.claude/settings.json` | Bạn dùng stackcrew ở mọi dự án. Dự án chưa init không bị ảnh hưởng: không có `.stackcrew/guard.json` thì hook cho qua, còn các lệnh `/stackcrew:*` chỉ chạy khi bạn gõ. |
| project | `--scope project` | `.claude/settings.json` (commit vào repo) | Cả team cùng dùng trong repo này. |
| local | `--scope local` | `.claude/settings.local.json` | Chỉ bạn, chỉ trong repo này. |

### Cài cho cả team

Một người chạy trong repo dự án rồi commit:

```bash
claude plugin marketplace add quoioln/stackcrew --scope project
claude plugin install stackcrew@stackcrew --scope project
git add .claude/settings.json
```

`.claude/settings.json` khi đó có:

```json
{
  "extraKnownMarketplaces": {
    "stackcrew": {
      "source": { "source": "github", "repo": "quoioln/stackcrew" }
    }
  },
  "enabledPlugins": {
    "stackcrew@stackcrew": true
  }
}
```

Dùng nguồn GitHub, **không** dùng đường dẫn local: `claude plugin marketplace add <đường-dẫn> --scope project` ghi đường dẫn trên máy bạn (`C:\...`) vào file này, và file sẽ hỏng trên máy người khác.

Mỗi thành viên còn phải:

- chấp nhận hộp thoại tin cậy thư mục (workspace trust) khi mở repo lần đầu. Chưa tin cậy thì Claude Code lặng lẽ bỏ qua `extraKnownMarketplaces`;
- chạy một lần `claude plugin install stackcrew@stackcrew --scope project`. File settings chỉ bật plugin, không tải plugin về máy họ;
- có quyền đọc repo `quoioln/stackcrew` nếu repo private.

### Cập nhật, tắt, gỡ

```bash
claude plugin marketplace update stackcrew     # kéo bản mới của marketplace
claude plugin update stackcrew@stackcrew       # cập nhật plugin; thêm --scope project nếu cài ở project scope
claude plugin disable stackcrew@stackcrew      # tắt tạm; bật lại bằng enable
claude plugin uninstall stackcrew@stackcrew    # gỡ; thêm --scope tương ứng
```

Sau khi cập nhật, gõ `/reload-plugins` trong phiên đang mở hoặc mở phiên mới. Plugin khai `version` cố định, nên `update` chỉ lấy bản mới khi `version` đã tăng (xem "Phát triển"); nếu chưa tăng, nó báo `already at the latest version`.

### Lệnh trong phiên

Các lệnh này chỉ chạy khi bạn gõ; agent không tự gọi chúng.

| Lệnh | Việc làm | Ví dụ |
| --- | --- | --- |
| `/stackcrew:init` | Phỏng vấn kiến trúc từng câu một. Đề xuất stack, add-on, kiến trúc, pattern và messaging kèm lý do, chờ bạn duyệt, rồi ghi `stackcrew.json` (`context`, `decisions`) và chạy `sync`. Khi đã có `stackcrew.json`, chỉ hỏi phần thay đổi và cập nhật `context`/`decisions`. | `/stackcrew:init` |
| `/stackcrew:sync` | Render lại từ `stackcrew.json`. Cờ: `--force`, `--wire`, `--dry-run`. | `/stackcrew:sync --dry-run` |
| `/stackcrew:add <addon...>` | Thêm add-on vào profile rồi sync. | `/stackcrew:add kafka observability` |
| `/stackcrew:check` | Quét các dòng mới thêm theo luật guard. Cờ: `--base <ref>`, `--staged`. | `/stackcrew:check --base origin/main` |

`list`, `detect`, `version` không có lệnh trong phiên; `/stackcrew:init` tự chạy `detect` và `list`. Muốn chạy tay, dùng tiền tố `!` của Claude Code, ví dụ `! npx --yes github:quoioln/stackcrew detect`.

### Gọi skill và agent sau khi init

Với tool `claude`, `init`/`sync` sinh ra:

- **Rule** trong `.claude/rules/stackcrew/`. Claude Code tự nạp: rule always-on nạp mọi lúc, rule theo glob nạp khi agent đụng file khớp (ví dụ `*.java`).
- **Skill theo việc** trong `.claude/skills/stackcrew-*/`. Agent tự dùng khi việc khớp mô tả, hoặc bạn gọi thẳng bằng `/<tên-skill>`. Với Spring Boot có `/stackcrew-spring-rest-endpoint`, `/stackcrew-spring-integration-provider`, `/stackcrew-spring-boot-testing`, `/stackcrew-spring-kafka-consumer` (khi có add-on `kafka`), cùng `/stackcrew-pattern-guide` và `/stackcrew-messaging-choice`.
- **Agent (vai)** trong `.claude/agents/`: `stackcrew-tech-lead` (model opus, chỉ đề xuất và review, không viết code), `stackcrew-<stack>-developer` và `stackcrew-<stack>-tester` (với Spring Boot: `stackcrew-spring-boot-developer`, `stackcrew-spring-boot-tester`). Đây là agent của dự án nên không có tiền tố `stackcrew:` như lệnh plugin. Agent chỉ chạy khi được gọi đích danh:
  - gõ `@`, chọn agent trong danh sách gợi ý, rồi viết việc cần làm, ví dụ `@"stackcrew-spring-boot-developer (agent)" thêm provider eKYC HyperVerge theo playbook tích hợp`;
  - hoặc nêu tên trong câu lệnh, ví dụ "Dùng agent stackcrew-tech-lead review thiết kế tích hợp C06";
  - hoặc chạy cả phiên dưới một vai: `claude --agent stackcrew-spring-boot-developer`.

  Gõ `/agents` để xem danh sách agent.
- **Guard hook** chạy mỗi lần Claude gọi `Write`, `Edit` hoặc `MultiEdit`. Khi bị chặn, Claude nhận thông báo vi phạm và phải sửa lại (xem "Guard hook và `stackcrew-allow`").

### Thử plugin mà không cài (khi sửa stackcrew)

```bash
claude --plugin-dir <đường-dẫn-repo-stackcrew>/plugin
```

Plugin chỉ có hiệu lực trong phiên đó. Nếu máy đã cài `stackcrew@stackcrew`, nên tắt bản đó trước (`claude plugin disable stackcrew@stackcrew`) để tránh nạp hai bản plugin và hai guard hook.

## Các lệnh

Đây là lệnh của CLI (`stackcrew <lệnh>`, xem "Cài đặt"). Trong Claude Code, `init`, `sync`, `add` và `check` có lệnh `/stackcrew:*` tương ứng (xem "Dùng với Claude Code"). Ví dụ chạy từng lệnh kèm output: xem "Ví dụ dùng CLI".

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

  Test sinh ra có 5 test: 4 rule (khai báo dạng method `@ArchTest`) và `base_package_contains_classes`. Test cuối fail khi `java.basePackage` không khớp class nào, vì khi đó 4 rule sẽ pass mà không kiểm gì. Sau `mvn test` / `gradle test`, log phải có `Tests run: 5`. Đã kiểm với Maven 3.9.12 trên Spring Boot 3.2.12, 3.3.13, 3.4.9, 3.5.4, 3.5.11 (surefire 3.1.2, 3.2.5, 3.5.3, 3.5.4) và Gradle 8.14.4 trên Spring Boot 3.4.9 (xem "Giới hạn hiện tại").
- `check` thoát `0` khi sạch, `1` khi có vi phạm, `2` khi không chạy được (ngoài git repo, thiếu base ref, thiếu `.stackcrew/guard.json`). Nó không bao giờ in "0 violations" khi không chạy được. Không có cờ nào thì quét thay đổi so với `HEAD` kèm file chưa theo dõi.

## Ví dụ dùng CLI

Các ví dụ chạy trên dự án mẫu `fixtures/spring-boot-minimal` (package `com.example.kyc`). Output chép từ lần chạy thật; phần dài được cắt bằng `…`.

### Cài lệnh `stackcrew` một lần

```bash
npm i -g github:quoioln/stackcrew   # tạo lệnh stackcrew trên Windows, Linux, macOS; chạy lại để lấy bản mới
stackcrew version                   # 0.1.0
```

Không muốn cài global thì thay `stackcrew` bằng `npx --yes github:quoioln/stackcrew` trong mọi ví dụ dưới đây.

### Xem trước: stack hỗ trợ và stack của dự án

```console
$ stackcrew list
Stacks:
  spring-boot  Spring Boot  backend  min 3.0
Addons:
  camel  Apache Camel  languages: java
  kafka  Apache Kafka  languages: all
  observability  Observability (Loki, Grafana)  languages: all
  rabbitmq  RabbitMQ  languages: all

$ stackcrew detect
stack: spring-boot
candidates: spring-boot
addons: none
mode: brownfield
basePackage: com.example.kyc
```

`mode: brownfield` nghĩa là dự án đã có code: rule chỉ áp cho code mới và code sửa.

### Init dự án có sẵn, rồi nối ArchUnit

```console
$ stackcrew init --stack spring-boot --addons kafka,observability --tools claude,cursor
stackcrew sync: 59 written, 0 unchanged, 0 deleted, 2 block(s) updated
hint: run `stackcrew sync --wire` to add ArchUnit (test scope) and generate StackcrewArchitectureTest
…

$ stackcrew sync --wire
wired: pom.xml
stackcrew sync: 1 written, 59 unchanged, 0 deleted, 0 block(s) updated
note: .stackcrew/lint/checkstyle.xml is generated but not wired; …

$ mvn test
```

- `mvn test` phải in `Tests run: 5` cho `StackcrewArchitectureTest`. Sau lần chạy đầu, commit cả thư mục `archunit_store/`.
- Bỏ `--addons` thì `init` dùng add-on detect được. Bỏ `--tools` thì sinh cho cả 4 tool (`claude,cursor,codex,antigravity`).

### Thêm add-on

```console
$ stackcrew add rabbitmq
stackcrew sync: 3 written, 59 unchanged, 0 deleted, 0 block(s) updated

$ stackcrew add mongo
stackcrew.json: addons[3]: unknown addon "mongo"
Available addons: camel, kafka, observability, rabbitmq
```

Add-on sai tên thì lệnh thoát `1` và không ghi gì.

### Sửa profile rồi render lại

Sửa `stackcrew.json`, ví dụ thêm `"antigravity"` vào `tools`, rồi xem trước và áp dụng:

```console
$ stackcrew sync --dry-run
stackcrew sync: 41 written, 62 unchanged, 0 deleted, 0 block(s) updated

$ stackcrew sync
stackcrew sync: 41 written, 62 unchanged, 0 deleted, 0 block(s) updated
```

Với `--dry-run`, các con số là số file **sẽ** ghi hoặc xóa; lệnh không ghi gì.

### Khi file sinh ra bị sửa tay

```console
$ stackcrew sync
stackcrew sync: …
skipped (edited by hand): .claude/rules/stackcrew/core.md
re-run with --force (your edits will be lost) or move them to .stackcrew/custom/
```

Lệnh thoát `1`. Chuyển phần bạn sửa sang rule riêng trong `.stackcrew/custom/` (xem "Rule riêng"), rồi chạy `stackcrew sync --force` để đưa file về bản sinh ra.

### Quét dòng mới bằng `check`

Giả sử nhánh `feature/hyperverge` thêm file:

```java
public class HyperVergeClient {
    private JsonNode lastResponse;
    private Map<String, Object> payload;
    private final String baseUrl = "https://ind-docs.hyperverge.co/v2.0";
}
```

```console
$ stackcrew check
src/main/java/com/example/kyc/provider/HyperVergeClient.java:7 [SC-TYPE] JsonNode/ObjectNode is an untyped payload (SC-TYPE). Define a record/DTO …
    > private JsonNode lastResponse;
src/main/java/com/example/kyc/provider/HyperVergeClient.java:8 [SC-TYPE] Map<String, Object> is an untyped bag (SC-TYPE). …
    > private Map<String, Object> payload;
src/main/java/com/example/kyc/provider/HyperVergeClient.java:9 [SC-CONST] Hardcoded URL (SC-CONST). Environment URLs belong in @ConfigurationProperties / application.yml; …
    > private final String baseUrl = "https://ind-docs.hyperverge.co/v2.0";
stackcrew check: 3 violation(s)

$ stackcrew check --base origin/develop
stackcrew check: base ref not found: origin/develop (fetch it first, e.g. `git fetch origin <branch>`)
```

Chọn phạm vi quét:

| Lệnh | Quét | Dùng khi |
| --- | --- | --- |
| `stackcrew check` | Thay đổi chưa commit so với `HEAD`, gồm cả file chưa track | Tự kiểm trong lúc code |
| `stackcrew check --staged` | Phần đã `git add` | Git hook pre-commit |
| `stackcrew check --base origin/main` | Mọi commit của nhánh so với `origin/main` | Review PR, Jenkins |

Sau khi đã commit hết, `stackcrew check` không cờ in `0 violations in 0 added line(s) across 0 file(s)`: muốn quét các commit của nhánh thì phải dùng `--base`.

Mã thoát: `0` sạch, `1` có vi phạm, `2` không chạy được (như ví dụ `origin/develop` ở trên).

Ngoại lệ có lý do, viết trên cùng dòng:

```java
private Map<String, Object> body; // stackcrew-allow: SC-TYPE GPay callback có field động, map sang GpayCallback ngay sau khi parse
```

```console
$ stackcrew check --staged
stackcrew check: 0 violations in 7 added line(s) across 1 file(s)
```

### Chặn commit bằng git hook

`.git/hooks/pre-commit` (cần lệnh `stackcrew` trên PATH, xem "Cài lệnh `stackcrew` một lần"):

```sh
#!/bin/sh
# stackcrew: chặn commit khi dòng mới vi phạm luật guard
stackcrew check --staged
```

- Trên Linux/macOS, chạy thêm `chmod +x .git/hooks/pre-commit`.
- Commit có vi phạm sẽ bị dừng và in danh sách vi phạm như ví dụ trên.
- `.git/hooks` không được commit. Muốn cả team dùng chung: commit hook vào thư mục `.githooks/`, rồi mỗi người chạy `git config core.hooksPath .githooks`.

### Init lại, hoặc tắt guard hook

```console
$ stackcrew init --stack spring-boot
stackcrew: already initialized (stackcrew.json exists); use `stackcrew sync`

$ stackcrew init --force --stack spring-boot --addons kafka,observability --tools claude
overwriting existing stackcrew.json (kept: decisions, context, java settings)
…
```

- `--force` giữ `decisions`, `context` và `java` (kể cả trạng thái đã wire).
- `addons` và `tools` lấy lại từ cờ. Bỏ `--addons` thì quay về add-on detect được, nên nhớ truyền lại. File của tool bị bỏ khỏi `--tools` sẽ bị xóa.
- Thêm `--no-guard` để tắt guard hook lúc ghi của Claude Code (`.stackcrew/guard.json` có `"enabled": false`). `stackcrew check` (pre-commit, Jenkins) **vẫn quét** như thường.

## Jenkins

`init`/`sync` sinh đoạn stage tại `.stackcrew/ci/Jenkinsfile.stackcrew.groovy`:

```groovy
stage('stackcrew check') {
  steps {
    sh 'npx --yes stackcrew@<version> check --base "origin/${CHANGE_TARGET:-main}"'
  }
}
```

Snippet dùng `sh`: agent Windows dùng `bat` thay cho `sh`. Khi `CHANGE_TARGET` chưa được đặt (build không phải PR), snippet mặc định so với `main`.

Snippet gọi gói `stackcrew@<version>` trên npm, mà gói này chưa được publish (Plan 3). Trước khi publish, thay bằng `npx --yes github:quoioln/stackcrew#<tag-hoặc-commit> check --base ...` (agent Jenkins cần quyền đọc repo) hoặc `node <đường-dẫn-repo-stackcrew>/bin/stackcrew.js check --base ...`.

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
- `--wire` chỉ nối được build **một module**. Với Maven nhiều module (root có `<packaging>pom</packaging>` hoặc `<modules>`), stackcrew không sửa pom nào, in đoạn dependency và thoát `1`: hãy thêm ArchUnit vào module chứa class ứng dụng (test sinh ra nằm ở `src/test/java` của root nên sẽ không chạy trong build nhiều module).
- Khi chọn đồng thời `claude`, `cursor` và `codex`, Cursor đọc cả `.claude/skills` lẫn `.agents/skills` nên skill có thể hiện **hai lần**. `sync` in cảnh báo `cursor-duplicate-skills`.
- Khi chọn `cursor` cùng `codex`, Cursor còn đọc `.codex/agents` nên agent của stackcrew có thể hiện **hai lần**; `sync` in cảnh báo `cursor-duplicate-agents`. Chưa rõ Cursor có thật sự đọc `.codex/agents/*.toml` không (xem `docs/manual-checklist.md`).
- Guard hook lúc ghi (L2) **chỉ có trên Claude Code**. Tool khác chỉ có L1 (rule) và L3 (build, CI).
- `.stackcrew/lint/checkstyle.xml` được sinh nhưng **chưa nối** vào build: thêm `maven-checkstyle-plugin` (hoặc plugin checkstyle của Gradle) trỏ vào file đó.
- ArchUnit dùng `FreezingArchRule`: lần chạy test đầu tiên ghi vi phạm hiện có vào thư mục `archunit_store/`. **Phải commit `archunit_store/`**; từ đó chỉ vi phạm mới làm test fail.
- Surefire 3.5.3 (Spring Boot 3.4.5–3.4.9 và 3.5.0–3.5.5 khóa phiên bản này) bỏ kết quả của rule ArchUnit khai báo dạng field (`@ArchTest static final ArchRule ...`): rule vẫn chạy nhưng log báo `Tests run: 0` và build vẫn xanh dù có vi phạm. Test do stackcrew sinh khai báo mọi rule dạng method (`@ArchTest static void ten_rule(JavaClasses classes)`) nên không bị ảnh hưởng, với mọi phiên bản surefire. Rule ArchUnit **của bạn** trong class khác: viết dạng method, hoặc nâng surefire lên 3.5.4 trở lên (với `spring-boot-starter-parent`: `<maven-surefire-plugin.version>3.5.4</maven-surefire-plugin.version>`).
- Gradle không dùng surefire nên không bị lỗi trên. Task `test` phải có `useJUnitPlatform()` (Spring Initializr có sẵn); thiếu dòng này thì Gradle không chạy test JUnit 5 nào, kể cả ArchUnit.
- Codex không có glob nên `AGENTS.md` chỉ chứa các Essentials rút gọn (tối đa 5 mục mỗi rule, tự giảm 5 → 3 → 1 kèm cảnh báo `agents-md-essentials-reduced` nếu vượt ngân sách 16.000 byte); phần đầy đủ nằm trong skill `stackcrew-spring-boot-rules`.

## Phát triển

```bash
npm test                     # node --test, không cần cài dependency
node bin/stackcrew.js plugin # sinh lại plugin/ và .claude-plugin/ sau khi đổi catalog/, src/ hoặc bin/
```

- `test/plugin-drift.test.js` sẽ fail nếu quên chạy `plugin` sau khi sửa.

Phát hành bản plugin mới:

1. Tăng `version` trong `package.json`.
2. Chạy `node bin/stackcrew.js plugin`. Lệnh này ghi version mới vào `plugin/.claude-plugin/plugin.json` và `.claude-plugin/marketplace.json`.
3. Chạy `npm test`, rồi commit và push lên `main`.
4. Người dùng chạy `claude plugin marketplace update stackcrew`, rồi `claude plugin update stackcrew@stackcrew`.

Push mà không tăng `version` thì người đã cài vẫn giữ bản cũ.
- `fixtures/spring-boot-minimal/` là dự án mẫu cho `test/e2e.test.js` (có vi phạm cài sẵn trong `BadService`). Nó không nằm trong gói npm.
- Danh sách kiểm thử tay trên Cursor, Codex, Antigravity: xem `docs/manual-checklist.md`.
