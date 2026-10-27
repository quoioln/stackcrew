# stackcrew.json schema

`stackcrew.json` sits at the project root. `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" sync` renders all generated files from it. Edit the JSON directly, keep every field you are not changing, and keep two-space indentation.

## Shape

```
{
  "version": 1,
  "stack": "<stack id>",
  "addons": ["<addon id>"],
  "tools": ["claude" | "cursor" | "codex" | "antigravity"],
  "mode": "greenfield" | "brownfield",
  "guard": true,
  "context": { "<topic>": "<string>" },
  "decisions": [
    { "id": "D-001", "area": "...", "decision": "...", "rationale": "...", "rejected": ["..."] }
  ],
  "java": { "basePackage": "com.acme.app", "wired": false },
  "node": { "wired": false },
  "conventions": { "<key>": "<value>" }
}
```

Fields:
- `version`: always `1`.
- `stack`: a stack id from the catalog, for example `spring-boot`.
- `addons`: add-on ids that apply to the stack's language: `camel`, `kafka`, `observability`, `rabbitmq`.
- `tools`: at least one of `claude`, `cursor`, `codex`, `antigravity`.
- `mode`: `greenfield` or `brownfield`.
- `guard`: `true` enables the write-time guard.
- `context`: free-form map of string to string, one key per interview topic (domain, integrations, scale, timeline, stability, extensibility, team, stack, tools). Values are plain strings, not arrays or objects.
- `decisions`: ordered list. Each entry has string `id`, `area`, `decision`, `rationale` and a string array `rejected` (empty when no alternative was weighed). Use ids `D-001`, `D-002`, ... and never reuse or renumber one. To change a decision, add a new entry that says it supersedes the old one in its `rationale`.
- `java`: only for Java stacks. `basePackage` is a valid Java package or `""`. `wired` is `true` once ArchUnit is wired into the build; `sync --wire` sets it, so do not set it by hand.
- `node`: only for TypeScript stacks. `node.wired` is `true` once the stackcrew rules are wired into the project's ESLint config; `sync --wire` sets it, so never edit `node` by hand.
- `conventions`: optional object of per-project conventions. Keep only the keys that differ from the default; a missing key means its default. An unknown key or an invalid value makes `sync` exit 1 and write nothing.

## Conventions

| key | default | meaning |
|---|---|---|
| `sharedLibraries` | `[]` | Internal packages or modules to reuse instead of re-implementing. Array of non-empty strings. |
| `baseEntity` | `"BaseEntity"` | Name of the abstract base class for entities (audit fields). An identifier. |
| `baseTenantEntity` | `"BaseTenantEntity"` | Name of the abstract base class for tenant-scoped entities. An identifier. |
| `tenantClaim` | `"tenant_id"` | Token claim or session field that carries the tenant id. |
| `tenantColumn` | `"tenantId"` | Name of the tenant column or field on tenant-scoped entities. An identifier. |
| `rolesClaim` | `"roles"` | Token claim or session field that carries the user's roles. |
| `crossTenantRoles` | `["super_admin"]` | Roles allowed to read across tenants. An empty list disables cross-tenant access. |
| `sharedComponents` | `"src/components/ui"` | Folder of shared UI components (fullstack and frontend stacks). Relative POSIX path from the project root: no leading `/`, no `\`, no `..`. With shadcn, the folder that `aliases.ui` in `components.json` resolves to. |
| `systemUser` | `"system"` | Audit user recorded when no user is in context (jobs, migrations). |
| `typeFreeFiles` | `[]` | Globs of files where the guard forbids declaring a type or interface (TypeScript stacks). When non-empty it replaces the stack default (service files). Array of non-empty strings. |

`tenantClaim`, `rolesClaim`, `systemUser` and every role in `crossTenantRoles` may use only the characters `A-Z a-z 0-9 _ . : / -`, because they end up in code, YAML and a comma-separated list.

## Example: eKYC provider hub on Spring Boot

```json
{
  "version": 1,
  "stack": "spring-boot",
  "addons": ["kafka", "observability"],
  "tools": ["claude", "cursor"],
  "mode": "greenfield",
  "guard": true,
  "context": {
    "domain": "eKYC verification service for a lending app",
    "integrations": "5 eKYC providers over REST, one sends signed callbacks",
    "scale": "50k users, peak 120 TPS",
    "timeline": "first release in 3 months",
    "stability": "high; a wrong verification result is a compliance incident",
    "extensibility": "6 to 10 more providers within a year",
    "team": "6 Java developers, no Kafka experience",
    "stack": "Spring Boot 3, Java 17",
    "tools": "Claude Code and Cursor"
  },
  "decisions": [
    {
      "id": "D-001",
      "area": "provider integration",
      "decision": "Hexagonal architecture; one ProviderPort with an adapter per provider, an anti-corruption mapper per adapter, a registry keyed by provider id, and a Template Method base for the shared call flow",
      "rationale": "Many providers are expected and the number will grow, so adding provider N must not touch the domain. Provider DTOs must not leak into the domain. All providers share auth, call, map and audit steps.",
      "rejected": [
        "Layered service with if/else per provider: grows with every provider",
        "Apache Camel routes: no routing or transformation need beyond what adapters cover"
      ]
    },
    {
      "id": "D-002",
      "area": "messaging",
      "decision": "Kafka for verification-result events, with an outbox table and idempotent consumers; provider callbacks are deduplicated by an idempotency key",
      "rationale": "Several downstream services consume results at their own pace, need replay, and need an audit trail. Delivery is at-least-once, so handlers must be idempotent.",
      "rejected": [
        "In-process events: lost on a crash, no replay",
        "RabbitMQ: no replay, weaker audit trail"
      ]
    }
  ],
  "java": { "basePackage": "com.acme.ekyc", "wired": false },
  "conventions": {
    "sharedLibraries": ["com.acme.platform:acme-common"],
    "baseEntity": "AuditedEntity",
    "baseTenantEntity": "AuditedTenantEntity",
    "tenantClaim": "org_id",
    "crossTenantRoles": ["platform_admin"]
  }
}
```
