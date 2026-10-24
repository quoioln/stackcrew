---
id: addon-camel
title: Apache Camel
---
# Apache Camel

Applies when the profile lists the `camel` add-on. Camel is for JVM stacks only (Spring Boot, Quarkus via Camel Quarkus), so this add-on is not offered for NestJS, Next.js or Go: those stacks use an adapter, registry and resilience library written in the project. Examples target Camel 4.4 or later with `camel-spring-boot-starter` on Spring Boot 3 and Java 17+.

## Essentials

- Routes are Java code: a `RouteBuilder` `@Component` per route, `routeId` constants, logic in injected beans. A route reads as a pipeline: receive, unmarshal, validate, transform, send.
- Two entries per flow: an async broker entry (unmarshal, validate, dedupe, dead-letter) and a `direct:` port entry for typed synchronous callers that lets typed exceptions propagate (no `handled(true)`, no dead-letter channel).
- Async entry: `errorHandler(deadLetterChannel(...))` with `maximumRedeliveries`, delay, backoff, `useOriginalMessage()`; `onException(...)` with `maximumRedeliveries(0)`, `handled(true)`, `useOriginalMessage()` for failures a retry cannot fix. The default handler redelivers nothing.
- Dedupe with `idempotentConsumer(...)` on a business id header, persistent repository, `eager(false)` for at-least-once sources. Effect-level idempotency is the real guarantee.
- Bodies are typed: `unmarshal().json(JsonLibrary.Jackson, Dto.class)` into a record at the async edge, a validation step, a mapper bean. No `Map<String, Object>` or `JsonNode` bodies.
- Protect third parties with `throttle(...)` in `totalRequestsMode()` (per provider), timeouts on every HTTP endpoint, and no Camel redelivery stacked on Resilience4j retry for the same call.
- Endpoint URIs, route ids, header names and bean names are constants (`CamelEndpoints`, `RouteIds`, `CamelHeaders`, `CamelBeans`). Hosts, timeouts and limits are typed properties.
- Never log message bodies or secret headers. Keep `logExhaustedMessageBody` off (the default). Put route id, exchange id and correlation id in MDC.
- Test every route with `@CamelSpringBootTest` and mock endpoints: success, retry then success, exhausted to dead-letter, duplicate dropped, invalid payload dead-lettered, typed exception reaching the synchronous caller.

## Dependencies and layout

- Runtime: `camel-spring-boot-starter`, `camel-jackson-starter` (JSON), `camel-bean-validator-starter` (validation), `camel-http-starter` (or the component you use), `camel-micrometer-starter` (metrics), `camel-sql` for the JDBC idempotent repository. Keep every `org.apache.camel` artifact on the Camel BOM version. Camel 4 needs Java 17 and Spring Boot 3.
- Test: `spring-boot-starter-test` and `camel-test-spring-junit5` (JUnit 5). Newer Camel lines ship `camel-test-spring-junit6`: use the one that matches the JUnit major in the project.
- Camel auto-detects every `RouteBuilder` in the Spring context. A `@Component` is enough.
- Package routes by flow (`order.route`, `provider.c06.route`), mappers and DTOs beside them.
- The provider port from `stackcrew-spring-integration-provider` stays. A `CamelProviderAdapter implements ProviderPort` calls the `direct:` port entry through `ProducerTemplate.requestBody(...)` with a typed record and maps the typed reply through the same ACL mapper. `ProducerTemplate` wraps a failure in `CamelExecutionException`: the adapter unwraps the cause and rethrows the typed provider exception.

## Route skeleton

Two route builders per flow, so the dead-letter handling of the async entry never swallows an error that a synchronous caller needs.

```java
@Component
class VerifyC06IngressRoute extends RouteBuilder {              // async entry: broker in, dead-letter on failure
    private final RouteRetryProperties retry;

    VerifyC06IngressRoute(RouteRetryProperties retry) { this.retry = retry; }

    @Override
    public void configure() {
        errorHandler(deadLetterChannel(CamelEndpoints.DEAD_LETTER)
            .maximumRedeliveries(retry.maxRedeliveries())
            .redeliveryDelay(retry.delayMs())
            .useExponentialBackOff()
            .backOffMultiplier(retry.multiplier())
            .useOriginalMessage()
            .retryAttemptedLogLevel(LoggingLevel.WARN));

        onException(JsonProcessingException.class, BeanValidationException.class, InvalidRequestException.class, ProviderRejectedException.class)
            .maximumRedeliveries(0)
            .useOriginalMessage()                               // the dead-letter endpoint gets the message as received
            .handled(true)
            .to(CamelEndpoints.DEAD_LETTER);

        from(CamelEndpoints.VERIFY_C06_IN)                      // a broker URI (kafka:, rabbitmq:)
            .routeId(RouteIds.VERIFY_C06_IN)
            .unmarshal().json(JsonLibrary.Jackson, VerifyRequest.class)
            .to(CamelEndpoints.VALIDATE_VERIFY_REQUEST)         // "bean-validator:verify-request": throws BeanValidationException
            .idempotentConsumer(header(CamelHeaders.REQUEST_ID)).idempotentRepository(CamelBeans.REQUEST_REPOSITORY).eager(false)
            .to(CamelEndpoints.VERIFY_C06);                     // the port entry below
    }
}

@Component
class VerifyC06Route extends RouteBuilder {                     // port entry: typed record in, typed result out
    private final RouteRetryProperties retry;
    private final ProviderMapper mapper;

    VerifyC06Route(RouteRetryProperties retry, ProviderMapper mapper) { this.retry = retry; this.mapper = mapper; }

    @Override
    public void configure() {
        from(CamelEndpoints.VERIFY_C06)                         // "direct:verify-c06": receives a VerifyRequest record
            .routeId(RouteIds.VERIFY_C06)
            .throttle(retry.maxRequestsPerPeriod()).totalRequestsMode().timePeriodMillis(retry.periodMs())
            .bean(mapper, ProviderMapper.TO_PROVIDER_REQUEST)
            .to(CamelEndpoints.C06_CALL)                        // typed request in, typed response out
            .bean(mapper, ProviderMapper.TO_DOMAIN_RESULT);     // no handled(true): typed exceptions reach the caller

        from(CamelEndpoints.C06_CALL)                           // the only place that touches HTTP and JSON text
            .routeId(RouteIds.C06_CALL)
            .marshal().json(JsonLibrary.Jackson)
            .to(CamelEndpoints.C06_HTTP)
            .unmarshal().json(JsonLibrary.Jackson, ProviderResponse.class);
    }
}
```

- `RouteRetryProperties` is a validated `@ConfigurationProperties` record. A repeated flow shape (the same steps for another provider) is a route template or a method taking the endpoint constants, not a copied class.
- `errorHandler(...)` applies to every route in the same `RouteBuilder`; `onException` clauses are matched by specificity. That is why the port entry is a separate builder with the default error handler: it redelivers nothing and propagates the exception to its caller. Called from the ingress route, the same exception reaches the ingress error handler and is dead-lettered there.
- The dead-letter endpoint is a durable destination (a Kafka topic, a RabbitMQ queue or a database table), never `log:` alone. It carries the original message, the route id and the exception class. Alert on its depth.
- `throttle(n)` allows `n` messages per `timePeriodMillis` in total-requests mode (default 1000 ms). Camel 4.3 changed the throttler and 4.4 restored both modes, so call `totalRequestsMode()` explicitly. `concurrentRequestsMode()` limits in-flight exchanges instead. It delays by default; `rejectExecution(true)` throws instead, which you must handle. For per-provider fairness give each provider its own route, or use `correlationExpression(header(...))`.

## Idempotent consumer

- The key is a business id in a header (set by the sender, or copied from the typed payload by a bean). Never the whole body or an offset.
- Use a persistent repository: the JDBC idempotent repository from `camel-sql` (a table keyed on processor name and message id; the primary key is what protects concurrent consumers), or a key-value repository on a shared store. Register it as a Spring bean and reference it by its name constant.
- Key lifecycle, which decides whether you lose or drop messages:
  - By default Camel adds the key eagerly, before the steps run, and removes it only when the exchange fails. A process crash mid-route leaves the key behind, and the broker redelivery is then dropped as a duplicate: a lost message. Use `eager(false)` for an at-least-once source, so the key is added only after the steps succeed. The cost is that two concurrent copies of the same message can both run: that is why effect-level idempotency is still required.
  - An exchange that the dead-letter channel or `onException(...).handled(true)` took over is still treated as a failure for this purpose: Camel removes its key (`removeOnFailure` is true by default). A replay of a dead-lettered message is therefore processed again and needs no key clean-up. Set `removeOnFailure(false)` only if you want a dead-lettered message to stay blocked until its key is removed by hand.
- The repository protects the route, not the effect. A database write inside the route is still made idempotent (see `stackcrew-spring-integration-provider`, callbacks, and the `kafka` add-on consumer rules).
- Purge old keys on a schedule that matches the longest replay window.

## Error handling details

- Defaults to know: no redelivery, a 1 second delay when you enable it, a 60 second cap on the delay, backoff off, exhausted messages logged at ERROR with the stack trace, retry attempts logged at DEBUG.
- Put `useOriginalMessage()` on the `errorHandler(...)` and on every `onException(...)` clause that dead-letters: each has its own setting, and without it the dead-letter endpoint receives the partly transformed message.
- `handled(true)` stops the route and the caller sees no exception: use it only on the async entry, where the dead-letter endpoint takes ownership. `continued(true)` ignores the exception and keeps routing: use it only for an optional step.
- Non-retryable failures (bad JSON, a validation error, a provider rejection) are listed in the `onException` clause with `maximumRedeliveries(0)`. Retry only transient failures (timeouts, 5xx).
- Circuit breaking with `circuitBreaker()` (camel-resilience4j) is an option, but one mechanism per call: Camel EIPs or Resilience4j decorators, not both.

## Testing

```java
@CamelSpringBootTest
@SpringBootTest
@MockEndpointsAndSkip(CamelEndpoints.C06_CALL)              // replaces the real provider call with a mock
class VerifyC06RouteTest {
    @Autowired private ProducerTemplate template;
    @EndpointInject("mock:" + CamelEndpoints.C06_CALL) private MockEndpoint provider;

    @BeforeEach
    void resetMock() { provider.reset(); }

    @Test
    void typed_request_reaches_the_provider_as_a_typed_body() throws InterruptedException {
        provider.expectedMessageCount(1);
        provider.message(0).body().isInstanceOf(ProviderRequest.class);
        provider.whenAnyExchangeReceived(exchange -> exchange.getMessage().setBody(cannedResponse()));
        template.requestBody(CamelEndpoints.VERIFY_C06, new VerifyRequest("req-1", "doc-1"), VerifyResult.class);
        provider.assertIsSatisfied();
    }

    @Test
    void provider_rejection_reaches_the_synchronous_caller() {
        provider.whenAnyExchangeReceived(exchange -> { throw new ProviderRejectedException(ProviderCodes.C06); });
        assertThatThrownBy(() -> template.requestBody(CamelEndpoints.VERIFY_C06, new VerifyRequest("req-2", "doc-1"), VerifyResult.class))
            .hasRootCauseInstanceOf(ProviderRejectedException.class);
    }
}
```

- The port entry is tested with typed records through `ProducerTemplate`. Test the async entry with `@UseAdviceWith` and `AdviceWith` (`replaceFromWith("direct:test-in")`) so the broker consumer is replaced by a `direct:` endpoint, then start the context. Mock the dead-letter endpoint the same way and assert it received the original message.
- `@MockEndpointsAndSkip` replaces an endpoint with a mock (the exchange does not reach the real one); `@MockEndpoints` adds a mock and still forwards. Wrap the HTTP call in its own `direct:` route, as above, so the mock sits on a `direct:` URI and the test needs no network. `NotifyBuilder` waits for an asynchronous route.
- Cover: success, a retry then success (the mock fails once), exhausted redelivery ends at the dead-letter endpoint with the original body, a duplicate request id is dropped, an invalid or malformed body is dead-lettered without redelivery, a crash before completion does not leave the key behind (`eager(false)`).
- Use short delays in tests (`redeliveryDelay(0)` through a test property), and never call the real provider.

## Observability

- Enable Camel MDC logging so `camel.routeId` and `camel.exchangeId` are in MDC next to `traceId` and the correlation id: on Camel 4.15+ add `camel-mdc-starter` and set `camel.mdc.enabled=true`. Earlier 4.x lines (4.4 to 4.14) use `useMDCLogging` on the `CamelContext`.
- Camel metrics go through Micrometer (`camel-micrometer-starter`): route exchanges, failures and durations by route id. Tag provider routes with the provider code so the per-provider RED dashboard works (see the `observability` add-on).
- Propagate `traceparent` and the correlation id as message headers on Kafka and RabbitMQ endpoints, and on HTTP calls.
