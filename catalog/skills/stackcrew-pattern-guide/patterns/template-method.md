# Template Method

A fixed skeleton with variable steps. The caller sees one operation; the order of the steps is decided once.

## Signals

- Two or more flows repeat the same order of steps and differ in a few: authenticate, call, map, audit (provider calls); validate, process, persist, notify (importers).
- A copy-pasted method where one line per copy changes.
- A cross-cutting step (audit, metrics, timing) that someone forgot in one of the copies.

## Use when

- The order of steps must be guaranteed (audit always runs, the response is always mapped before it leaves).
- At least two real variants exist, or the profile records that more are expected. For provider integrations this is the second provider (see `stackcrew-spring-integration-provider`: the `AbstractProviderAdapter` base is introduced at the second provider, or when `docs/stackcrew/architecture-profile.md` expects more).
- The variable part is small: 2 to 4 steps.

## Do not use when

- There is one variant and none planned. Write a plain class; extract the base at the second provider.
- The variants share almost nothing. Use Strategy instead.
- The steps would need many hooks and flags to cover every variant; the base is turning into a framework.
- You would inherit only to reuse a helper. Use a shared function (SC-REUSE).

## Idioms

### Java (Spring Boot / Quarkus)

- A public `final` method fixes the order; `protected abstract` methods are the steps. The base is generic over request and response types, so no `Object` or `Map` crosses a step.
- Constructor injection of the shared collaborators (audit, metrics, resilience registry) in the base; subclasses pass them up.
- Spring: subclasses are `@Component` beans and are collected into a `List<ProviderPort>`; the registry picks one (see [strategy.md](strategy.md)).
- Prefer composition when steps are few: a small class that takes the steps as functional interfaces (`Function`, `Supplier`) avoids an inheritance tree.

### TypeScript (NestJS / Next.js / React / Angular)

- Backend: an abstract class with a concrete `execute` and abstract steps works in NestJS, with the shared services injected through the constructor.
- Often simpler: a higher-order function `runFlow(steps)` that takes `{ authenticate, call, map }` as typed functions. No class hierarchy needed.
- React: a custom hook that owns the skeleton (loading, error, retry) and takes the variable step as an argument. Do not build a component class hierarchy.
- Angular: a base service with `protected abstract` steps is fine for services; for components prefer composition and `inject()`.

### Go

- No inheritance. Either a function that takes the steps (`func Run(ctx, steps Steps, in Request) (Result, error)`) where `Steps` is a struct of function fields, or a struct that embeds a small step interface.
- Keep step interfaces small (one to three methods) and define them where they are used.
- Shared behavior (audit, metrics) lives in the `Run` function, so every variant gets it.

## Example

Language: Java. The skeleton is fixed, the subclass fills the steps.

```java
public abstract class VerifyTemplate<REQ, RES> implements ProviderPort {
    private final ProviderAudit audit;

    protected VerifyTemplate(ProviderAudit audit) { this.audit = audit; }

    @Override
    public final VerifyResult verify(VerifyCommand command) {
        REQ request = toRequest(command);          // step 1: map domain -> provider
        RES response = call(request);              // step 2: remote call
        VerifyResult result = toResult(response);  // step 3: map provider -> domain
        audit.record(code(), command.referenceId(), result.status());  // fixed, cannot be skipped
        return result;
    }

    protected abstract REQ toRequest(VerifyCommand command);
    protected abstract RES call(REQ request);
    protected abstract VerifyResult toResult(RES response);
}
```

## AI anti-patterns

- Creating the abstract base for the first and only provider.
- A base with a dozen `protected` hooks and boolean flags, so each subclass overrides half of them.
- Letting a subclass override the public skeleton method (not `final`), so the audit step can be dropped.
- Typing the steps with `Object`, `Map<String, Object>` or `any` to make one base fit everything.
- Reaching for inheritance in Go or React where a function or hook is the idiom.
- Copying the flow into a new provider instead of extending the base that already exists.
