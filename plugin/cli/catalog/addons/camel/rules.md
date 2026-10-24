---
id: addon-camel
title: Apache Camel
---
# Apache Camel

Applies when the profile lists the `camel` add-on. Camel is for JVM stacks only (Spring Boot, Quarkus via Camel Quarkus), so this add-on is not offered for NestJS, Next.js or Go: those stacks use an adapter, registry and resilience library written in the project. Examples target Camel 4.x with `camel-spring-boot-starter` on Spring Boot 3 and Java 17+.

## Essentials

- Routes are Java code: one `RouteBuilder` per route or flow, a Spring `@Component`, with a stable `routeId` constant. The route reads as a pipeline (receive, unmarshal, validate, transform, send); logic lives in injected beans, not in inline processors.
- Declare the error handler on every route: `errorHandler(deadLetterChannel(...))` with `maximumRedeliveries`, `redeliveryDelay` and exponential backoff, and `useOriginalMessage()` so the dead-letter endpoint gets the message as received. The default handler redelivers nothing.
- Classify failures with `onException(...)`: a rejection or invalid payload is `maximumRedeliveries(0)` and `handled(true)` to the dead-letter endpoint; only transient failures (timeouts, 5xx) are redelivered.
- Dedupe with `idempotentConsumer(...)` on a business id, backed by a database repository. A memory repository is for tests only: it forgets on restart and is per instance.
- Bodies are typed: `unmarshal().json(JsonLibrary.Jackson, Dto.class)` into a record at the route edge, and a mapper bean to the provider or domain type. No `Map<String, Object>` or `JsonNode` bodies, no string-typed headers scattered through the route.
- Protect third parties with `throttle(...)` (per provider, with `timePeriodMillis`), timeouts on every HTTP endpoint, and do not stack Camel redelivery on top of Resilience4j retry for the same call.
- Endpoint URIs, route ids, header names and bean names are constants (`CamelEndpoints`, `RouteIds`, `CamelHeaders`). Externalize hosts, timeouts and limits to typed properties.
- Never log message bodies or secret headers. Camel logs the exhausted message at ERROR with a stack trace; keep `logExhaustedMessageBody` off (the default) and add the route id, exchange id and correlation id to MDC.
- Test every route with `@CamelSpringBootTest` and mock endpoints: success, retry then success, exhausted to dead-letter, duplicate dropped, throttled.

## Dependencies and layout

- Runtime: `camel-spring-boot-starter`, `camel-jackson-starter` for JSON, `camel-http-starter` (or the component you use), `camel-micrometer-starter` for metrics. Keep every `org.apache.camel` artifact on the Camel BOM version. Camel 4 needs Java 17 and Spring Boot 3.
- Test: `spring-boot-starter-test` and `camel-test-spring-junit5` (JUnit 5). Newer Camel lines ship `camel-test-spring-junit6`: use the one that matches the JUnit major in the project.
- Camel auto-detects every `RouteBuilder` in the Spring context. A `@Component` is enough; do not also add it to a list.
- Package routes by flow (`order.route`, `provider.c06.route`), mappers and DTOs beside them. The hand-written provider port from `stackcrew-spring-integration-provider` stays: a `CamelProviderAdapter implements ProviderPort` calls `ProducerTemplate` with a typed body.

## Route skeleton

```java
@Component
class VerifyC06Route extends RouteBuilder {
    private final RouteRetryProperties retry;
    private final ProviderMapper mapper;

    VerifyC06Route(RouteRetryProperties retry, ProviderMapper mapper) { this.retry = retry; this.mapper = mapper; }

    @Override
    public void configure() {
        errorHandler(deadLetterChannel(CamelEndpoints.DEAD_LETTER)
            .maximumRedeliveries(retry.maxRedeliveries())
            .redeliveryDelay(retry.delayMs())
            .useExponentialBackOff()
            .backOffMultiplier(retry.multiplier())
            .useOriginalMessage()
            .retryAttemptedLogLevel(LoggingLevel.WARN));

        onException(ProviderRejectedException.class, InvalidRequestException.class)
            .maximumRedeliveries(0)
            .handled(true)
            .to(CamelEndpoints.DEAD_LETTER);

        from(CamelEndpoints.VERIFY_C06)
            .routeId(RouteIds.VERIFY_C06)
            .unmarshal().json(JsonLibrary.Jackson, VerifyRequest.class)
            .idempotentConsumer(header(CamelHeaders.REQUEST_ID)).idempotentRepository(CamelBeans.REQUEST_REPOSITORY)
            .throttle(retry.maxRequestsPerPeriod()).timePeriodMillis(retry.periodMs())
            .bean(mapper, ProviderMapper.TO_PROVIDER_REQUEST)
            .to(CamelEndpoints.C06_CALL)                        // typed request in, typed response out
            .bean(mapper, ProviderMapper.TO_DOMAIN_RESULT);

        from(CamelEndpoints.C06_CALL)                           // the only place that touches HTTP and JSON text
            .routeId(RouteIds.C06_CALL)
            .marshal().json(JsonLibrary.Jackson)
            .to(CamelEndpoints.C06_HTTP)
            .unmarshal().json(JsonLibrary.Jackson, ProviderResponse.class);
    }
}
```

- `RouteRetryProperties` is a validated `@ConfigurationProperties` record. A repeated route shape (the same steps for another provider) is a route template or a method that takes the endpoint constants, not a copied class.
- `errorHandler(...)` applies to every route in the same `RouteBuilder`; `onException` clauses are checked in order of specificity. Keep the retry numbers in properties.
- The dead-letter endpoint is a durable destination (a Kafka topic, a RabbitMQ queue or a database table), never `log:` alone. It carries the original message, the route id and the exception class; alert on its depth.
- `throttle(n)` allows `n` messages per `timePeriodMillis` (default 1000 ms, total-requests mode). `concurrentRequestsMode()` limits in-flight exchanges instead. It delays by default; `rejectExecution(true)` throws instead, which you must handle. For per-provider fairness give each provider its own route, or use `correlationExpression(header(...))`.

## Idempotent consumer

- The key is a business id in a header (set by the sender, or copied from the typed payload by a bean). Never the whole body or an offset.
- Use a persistent repository: the JDBC idempotent repository from `camel-sql` (a table keyed on processor name and message id; the primary key is what protects concurrent consumers), or a key-value repository on a shared store. Register it as a Spring bean and reference it by its name constant.
- The repository protects the route, not the effect. A database write inside the route is still made idempotent (see `stackcrew-spring-integration-provider`, callbacks, and the `kafka` add-on consumer rules).
- Purge old keys on a schedule that matches the longest replay window.

## Error handling details

- Defaults to know: no redelivery, a 1 second delay when you enable it, a 60 second cap on the delay, backoff off, exhausted messages logged at ERROR with the stack trace, retry attempts logged at DEBUG.
- `handled(true)` stops the route and the caller sees no exception: use it only when the dead-letter endpoint takes ownership. `continued(true)` ignores the exception and keeps routing: use it only for an optional step.
- A synchronous caller (a REST endpoint calling `ProducerTemplate.requestBody`) must still get a typed, safe error: let the exception propagate to the controller advice instead of `handled(true)`, or return a typed failure result from the `onException` route.
- Circuit breaking with `circuitBreaker()` (camel-resilience4j) is an option, but one mechanism per call: Camel EIPs or Resilience4j decorators, not both.

## Testing

```java
@CamelSpringBootTest
@SpringBootTest
@MockEndpointsAndSkip(CamelEndpoints.C06_CALL)              // replaces the real provider call with a mock
class VerifyC06RouteTest {
    @Autowired private ProducerTemplate template;
    @EndpointInject("mock:" + CamelEndpoints.C06_CALL) private MockEndpoint provider;

    @Test
    void valid_request_reaches_the_provider_as_a_typed_body() throws InterruptedException {
        provider.expectedMessageCount(1);
        provider.message(0).body().isInstanceOf(ProviderRequest.class);
        provider.whenAnyExchangeReceived(exchange -> exchange.getMessage().setBody(cannedResponse()));
        template.sendBodyAndHeader(CamelEndpoints.VERIFY_C06, requestJson(), CamelHeaders.REQUEST_ID, "req-1");
        provider.assertIsSatisfied();
    }
}
```

- `@MockEndpoints` adds a mock beside the real endpoint and still forwards. Use `AdviceWith` with `@UseAdviceWith` to replace the real HTTP call or the consumer endpoint, and `NotifyBuilder` to wait for an asynchronous route.
- Cover: success, a retry then success (the mock fails once), exhausted redelivery ends at the dead-letter endpoint with the original body, a duplicate request id is dropped, an invalid body goes to the dead-letter endpoint without redelivery.
- `@MockEndpointsAndSkip` replaces an endpoint with a mock (the exchange does not reach the real one); `@MockEndpoints` adds a mock and still forwards. Wrap the HTTP call in its own `direct:` route, as above, so the mock sits on a `direct:` URI and the test needs no network. `AdviceWith` is the alternative.
- Use short delays in tests (`redeliveryDelay(0)` through a test property) so tests stay fast, and never call the real provider: replace the HTTP endpoint with a mock or WireMock.

## Observability

- Enable Camel's MDC logging (`useMDCLogging` on the CamelContext, `camel.main.use-mdc-logging` in Camel 4) so `camel.routeId` and `camel.exchangeId` are in MDC next to `traceId` and the correlation id.
- Camel metrics go through Micrometer (`camel-micrometer-starter`): route exchanges, failures and durations by route id. Tag provider routes with the provider code so the per-provider RED dashboard works (see the `observability` add-on).
- Propagate `traceparent` and the correlation id as message headers on Kafka and RabbitMQ endpoints, and on HTTP calls.
