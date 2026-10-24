# Stack selection

Use this table when the user has not chosen a stack. Recommend one stack with the reason from their interview answers, and name the runner-up. The stack decides the language, the rules and the skills that get rendered, so ask before changing it later.

Catalog status: only `spring-boot` ships rules and skills today. For any other row, tell the user that stackcrew has no rules for it yet and let them decide whether to go ahead without stack rules or pick a supported stack.

| Stack | Language and version | Choose when | Avoid when |
|---|---|---|---|
| **Spring Boot** | Java 17+, Spring Boot 3.x (`jakarta.*`) | Long-lived system, many integrations or transactions, high stability needs, Java team, wide ecosystem (Spring Data, Spring Kafka, Resilience4j, Camel) | Cold start and memory are the main constraint (scale-to-zero, very dense pods), or the team has no Java |
| **Quarkus** | Java 17+, Quarkus 3.x | JVM cloud-native service, fast start, low memory, native image, dense Kubernetes or serverless; Camel is still available as Camel Quarkus | The team already knows Spring well and needs its ecosystem, or the libraries you need only have Spring support |
| **NestJS** | TypeScript, current Node LTS | TypeScript team, medium scale, fast delivery, BFF or API layer | Heavy integration or transaction core, or CPU-bound work |
| **Next.js** | TypeScript, current Node LTS | Web product that needs SEO or server rendering, small full-stack team, tight deadline | Integration-heavy backend; keep the backend in another stack |
| **Go** | Go, `net/http` with `chi` | High throughput, low latency, many concurrent calls, gateways, small services | Rich domain modeling with a large ecosystem need, or a team new to Go on a short deadline |
| **React SPA** | TypeScript | Flexible interactive UI, an API already exists | SEO or server rendering is required (use Next.js) |
| **Angular** | TypeScript | Large enterprise app, many forms, strict structure wanted | Small or short-lived UI |

## How to decide
1. Start from team skills: a team that knows a stack well beats a theoretically better stack on a deadline.
2. Then integrations and stability: many third-party integrations and a stability need point to Spring Boot (or Quarkus when footprint matters).
3. Then scale and footprint: very high throughput or tiny footprint points to Go or Quarkus.
4. Then timeline: a short deadline favors what the team already ships in.
5. A web UI is a separate stack from the backend. Ask about both when the project has a UI.

State the recommendation as: stack, two reasons from the user's answers, one risk, and the runner-up with why it lost. Record it as a decision with the rejected stacks.
