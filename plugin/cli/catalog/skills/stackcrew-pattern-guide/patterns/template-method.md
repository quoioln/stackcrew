# Template Method

A fixed skeleton with variable steps. The caller sees one operation; the order of the steps is decided once.

## Signals

- Two or more flows repeat the same order of steps and differ in a few: authenticate, call, map, audit (provider calls); validate, process, persist, notify (importers).
- A copy-pasted method where one line per copy changes.
- A cross-cutting step (audit, metrics, timing) that someone forgot in one of the copies.

## Use when

- The order of steps must be guaranteed (audit always runs, on success and on failure; the response is always mapped before it leaves).
- At least two real variants exist, or the profile records that more are expected. Provider integrations are the exception to the rule of three: introduce the `AbstractProviderAdapter` base at the second provider, or at the first when `docs/stackcrew/architecture-profile.md` says more are expected (see `stackcrew-spring-integration-provider`, step 0).
- The variable part is small: 2 to 4 steps.

## Do not use when

- There is one variant and the profile expects exactly one. Write a plain adapter; extract the base at the second provider.
- The variants share almost nothing. Use [Strategy](strategy.md) instead.
- The steps would need many hooks and flags to cover every variant; the base is turning into a framework.
- You would inherit only to reuse a helper. Use a shared function (SC-REUSE).

## Idioms

### Java (Spring Boot / Quarkus)

- The public skeleton method calls `protected abstract` steps. The base is generic over request and response types, so no `Object` or `Map` crosses a step. Shared collaborators (audit, metrics, resilience registries) are injected in the base constructor; subclasses pass them up.
- Do not make the skeleton `final`. A `final` method called on a CGLIB proxy runs on the proxy instance, whose fields are null. Keep the method public, non-final, and document the contract in Javadoc.
- Audit and count both outcomes: `audit.success(...)` and `audit.failure(...)`, in a `try/catch` around the guarded call, so a failure is never silent.
- Resilience belongs in the template, applied programmatically (see [resilience.md](resilience.md)), not through annotations on the subclasses.
- Few steps? Composition works too: a small class that takes the steps as functional interfaces.

### TypeScript (NestJS / Next.js / React / Angular)

- Backend: an abstract class with a concrete `execute` and abstract steps works in NestJS, with the shared services injected through the constructor.
- Often simpler: a higher-order function `runFlow(steps, input)` that takes `{ authenticate, call, map }` as typed functions. No class hierarchy needed.
- React: a custom hook that owns the skeleton (loading, error, retry) and takes the variable step as an argument. Do not build a component class hierarchy.
- Angular: a base service with `protected abstract` steps is fine for services; for components prefer composition and `inject()`.

### Go

- No inheritance. Either a function that takes the steps (`Run(ctx, steps Steps, in Command) (Result, error)`) where `Steps` is a struct of function fields, or a struct that holds small step interfaces.
- Keep step interfaces small (one to three methods) and define them where they are used.
- Shared behavior (audit on success and on failure, metrics) lives in `Run`, so every variant gets it.

## Example

Language: Java. Domain types are the playbook's `VerifyCommand`, `VerifyResult` and `ProviderPort`. The skeleton is fixed; the subclass fills the steps.

```java
public abstract class AbstractProviderAdapter<REQ, RES> implements ProviderPort {
    private final String providerCode;
    private final ProviderAudit audit;

    protected AbstractProviderAdapter(String providerCode, ProviderAudit audit) {
        this.providerCode = providerCode;
        this.audit = audit;
    }

    @Override public String code() { return providerCode; }

    /** The template method. Not final: a final method on a CGLIB proxy runs with null fields. */
    @Override
    public VerifyResult verify(VerifyCommand command) {
        try {
            authenticate();
            VerifyResult result = toDomain(call(toRequest(command)));
            audit.success(providerCode, command.requestId());
            return result;
        } catch (RuntimeException e) {
            audit.failure(providerCode, command.requestId(), e.getClass().getSimpleName());
            throw e;
        }
    }

    protected void authenticate() { }                       // default no-op
    protected abstract REQ toRequest(VerifyCommand command);
    protected abstract RES call(REQ request);
    protected abstract VerifyResult toDomain(RES response);
}
```

## AI anti-patterns

- Creating the abstract base for the first and only provider when the profile expects exactly one.
- Declaring the skeleton method `final`, which breaks under a Spring proxy (null fields on the proxy instance).
- Auditing only the success path, so failures leave no trace.
- A base with a dozen `protected` hooks and boolean flags, so each subclass overrides half of them.
- Typing the steps with `Object`, `Map<String, Object>` or `any` to make one base fit everything.
- Reaching for inheritance in Go or React where a function or hook is the idiom.
- Copying the flow into a new provider instead of extending the base that already exists.
