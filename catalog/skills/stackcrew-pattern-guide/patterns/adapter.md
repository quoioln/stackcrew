# Adapter

Wrap a third-party API, SDK or legacy interface behind a port that the domain owns. One adapter per provider.

## Signals

- The code calls a vendor SDK or HTTP API directly from a service or controller.
- Two providers do the same job with different request shapes, auth and error codes.
- Tests cannot run without the vendor, or mock vendor types deep inside business logic.

## Use when

- You integrate with a system you do not control (payment, eKYC, bank, email, storage).
- The domain should speak its own types and errors; the vendor can change or be replaced.
- A second provider is likely, or a provider sandbox and production differ.

## Do not use when

- The library is a stable, generic utility used everywhere (a JSON mapper, a date library, a logger). Do not hide it.
- You would only rename the methods one-to-one with no translation and no isolation value; the port then adds nothing.
- The type is already your own. Adapting your own class to your own interface is noise.

## Idioms

### Java (Spring Boot / Quarkus)

- The port is an interface in the domain package, in domain types only (see `stackcrew-spring-integration-provider`). The adapter is a package-private `@Component` in the infrastructure package.
- Provider DTOs are package-private `record`s; they never leave the adapter (see [anti-corruption-layer.md](anti-corruption-layer.md)).
- Constructor injection of the HTTP client factory, properties and resilience objects. Wrap the remote call with [resilience](resilience.md); do not open a transaction around it.
- Add a `code()` to the port so a registry can select the adapter (see [strategy.md](strategy.md)). Share the skeleton with [Template Method](template-method.md) from the second provider.

### TypeScript (NestJS / Next.js / React / Angular)

- The port is an `interface` (or an abstract class used as a DI token, since interfaces vanish at runtime). The adapter is an `@Injectable()` class provided under that token.
- Validate the provider response with a schema (zod) at the adapter boundary and map to the domain type; do not return the raw JSON.
- Next.js: keep adapters in server-only modules; never import them from client components.
- Angular: an adapter service provided via `InjectionToken`; components depend on the port only.

### Go

- Define a small interface (one to three methods) in the consumer package. The adapter is a struct in an `internal/<provider>` package with a constructor `New(cfg, httpClient)`.
- Accept `*http.Client` or a small `Doer` interface so tests inject a fake transport.
- Map provider structs to domain structs inside the package; export only the domain types.

## Example

Language: TypeScript. The adapter maps a vendor response to the domain result.

```typescript
export interface KycPort {
  readonly code: string;
  verify(command: VerifyCommand): Promise<VerifyResult>;
}

const C06_CODE = 'C06';
const C06_RESPONSE = z.object({ state: z.enum(['OK', 'REJECTED']), ref: z.string() });

@Injectable()
export class C06Adapter implements KycPort {
  readonly code = C06_CODE;

  constructor(private readonly http: HttpService, private readonly config: C06Config) {}

  async verify(command: VerifyCommand): Promise<VerifyResult> {
    const body = await this.http.post(this.config.verifyUrl, toC06Request(command));
    const parsed = C06_RESPONSE.parse(body);
    return { status: parsed.state === 'OK' ? VerifyStatus.Approved : VerifyStatus.Rejected, reference: parsed.ref };
  }
}
```

## AI anti-patterns

- Calling the vendor client straight from a controller or service, then "adding an adapter later".
- Returning the vendor DTO from the adapter, so it leaks into the domain.
- One `UniversalProviderAdapter` with a `switch` on the provider code, instead of one adapter per provider.
- Wrapping a logger or a date library "in case we change it".
- A port with `Object`, `Map<String, Object>`, `any` or `interface{}` parameters so that it fits every vendor.
- Putting retry and timeouts inside the domain instead of the adapter.
