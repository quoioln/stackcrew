---
id: stack-spring-boot-testing
title: Spring Boot testing
---
# Spring Boot testing

JUnit 5, AssertJ, Mockito, Spring Boot test slices, Testcontainers, WireMock. Extends the core testing rule.

## Essentials

- Every third-party provider has a WireMock contract test covering success, 4xx, 5xx, timeout and a malformed body. Never call a real provider from a test.
- Use the narrowest test that proves the behavior: plain JUnit for domain logic, `@WebMvcTest` for controllers, `@DataJpaTest` for repositories, `@SpringBootTest` only for a few end-to-end paths.
- Test the database with Testcontainers running the real engine; H2 does not stand in for PostgreSQL, MySQL or Oracle behavior.
- Assertions use AssertJ (`assertThat`); structure each test as Arrange-Act-Assert and name it for the behavior (`rejectsExpiredToken`).
- Mock only true boundaries with Mockito (ports, clients). Never mock the class under test, a record or a value object.
- Cover at least three negative or edge cases per happy path, and every branch of changed logic.
- Keep tests deterministic: inject a `Clock`, no `Thread.sleep`, no dependence on order or on the network. Use Awaitility for async results.
- `StackcrewArchitectureTest` (ArchUnit) must stay green: no `JsonNode`/`ObjectNode`/`Map<String, Object>` in service or domain signatures, no field injection, no controller-to-repository dependency, no domain-to-infrastructure dependency. Its baseline `archunit_store` is committed and only shrinks.

## Slice tests

```java
@WebMvcTest(VerificationController.class)
class VerificationControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean VerificationService service;

    @Test
    void rejectsBlankDocumentNumber() throws Exception {
        mvc.perform(post("/v1/verifications").contentType(APPLICATION_JSON).content(BLANK_DOCUMENT_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").exists());
    }
}
```

- `@MockitoBean` replaces `@MockBean` in Spring Boot 3.4+; use `@MockBean` on 3.0 to 3.3.
- Request bodies in tests live in constants or `src/test/resources` fixtures, not inline literals repeated across tests.
- Assert on `ProblemDetail` fields (`status`, `title`, `detail`) for error paths.

## Testcontainers

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class VerificationRepositoryTest {
    @Container @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
}
```

- `@ServiceConnection` (Spring Boot 3.1+) wires the datasource without manual properties.
- Reuse one container per test class (static), and run migrations with Flyway or Liquibase so the schema is the real one.

## WireMock for providers

```java
@WireMockTest
class HypervergeAdapterTest {
    private static final String VERIFY_PATH = "/v1/verify";
    private static final Duration CONNECT = Duration.ofMillis(200);
    private static final Duration READ = Duration.ofMillis(300);
    private static final int READ_DELAY_MS = 900;

    @Test
    void mapsApprovedResponse(WireMockRuntimeInfo wm) {
        stubFor(post(VERIFY_PATH).willReturn(okJson(APPROVED_BODY)));
        HypervergeAdapter adapter = adapterFor(wm.getHttpBaseUrl(), 3);

        VerifyResult result = adapter.verify(COMMAND);

        assertThat(result.status()).isEqualTo(VerificationStatus.APPROVED);
    }

    @Test
    void timesOutAsUnavailable(WireMockRuntimeInfo wm) {
        stubFor(post(VERIFY_PATH).willReturn(ok().withFixedDelay(READ_DELAY_MS)));
        // one attempt: with retry on, the failure takes about maxAttempts x READ plus backoff, not one READ
        assertThatThrownBy(() -> adapterFor(wm.getHttpBaseUrl(), 1).verify(COMMAND))
            .isInstanceOf(ProviderUnavailableException.class);   // ResourceAccessException translated by the template
    }

    @Test
    void retriesOnceThenSucceeds(WireMockRuntimeInfo wm) {
        stubFor(post(VERIFY_PATH).inScenario(FLAKY).whenScenarioStateIs(STARTED)
            .willReturn(serverError()).willSetStateTo(RECOVERED));
        stubFor(post(VERIFY_PATH).inScenario(FLAKY).whenScenarioStateIs(RECOVERED).willReturn(okJson(APPROVED_BODY)));

        assertThat(adapterFor(wm.getHttpBaseUrl(), 3).verify(COMMAND).status()).isEqualTo(VerificationStatus.APPROVED);
    }

    /** Hand-built: Resilience4j runs inside the adapter template, so no Spring context is needed. */
    private HypervergeAdapter adapterFor(String baseUrl, int maxAttempts) {
        var endpoint = new ProviderProperties.Endpoint(baseUrl, CONNECT, READ);
        var clients = new ProviderClientFactory(new ProviderProperties(Map.of(ProviderCodes.HYPERVERGE, endpoint)), RestClient.builder());
        RetryRegistry retries = RetryRegistry.of(RetryConfig.custom().maxAttempts(maxAttempts).waitDuration(Duration.ofMillis(10))
            .retryExceptions(ProviderUnavailableException.class)
            .ignoreExceptions(ProviderRejectedException.class, ProviderProtocolException.class).build());
        return new HypervergeAdapter(clients, CircuitBreakerRegistry.ofDefaults(), retries,
            BulkheadRegistry.ofDefaults(), new NoOpProviderAudit(), new SimpleMeterRegistry());
    }
}
```

- One test class per adapter. The provider response bodies are fixtures that mirror the provider's documented payloads, including its error shapes.
- Cover: success, validation error (4xx), provider outage (5xx), timeout, malformed or missing fields, and a callback delivered twice (idempotency).
- Assert the mapping to the domain type, the typed exception for each failure, and that no provider record leaks out of the adapter.
- The test kit builds `ProviderClientFactory` by hand (public constructor), plus all three registries (`CircuitBreakerRegistry`, `RetryRegistry`, `BulkheadRegistry`) programmatically; the default registries do not carry the production exception lists, so set them as above when retry matters.
- Retry and circuit-breaker behavior is tested with a scenario (`inScenario`) that fails then succeeds, and with a 4xx that must produce exactly one request (`verify(1, postRequestedFor(...))`) and `ProviderRejectedException`.

## ArchUnit

- `StackcrewArchitectureTest` is generated into `src/test/java/<base package>/stackcrew/` when wiring is on. Do not edit it by hand; regenerate with the stackcrew `sync`.
- Add project-specific architecture rules in a separate test class in the same package tree.
- The rules are wrapped in `FreezingArchRule`: existing violations of a brownfield codebase are recorded in the `archunit_store` directory and only new violations fail. Commit `archunit_store`; it may only shrink, so fix violations and let the baseline lose lines, never add to it by hand or re-freeze to hide a new violation.
- The rules cover `..service..` and `..domain..` only (plus domain must not depend on `..infrastructure..` or `..adapter..`, and controllers must not depend on repositories). Boundary deserialization and framework config belong in `infrastructure`, `adapter` or `config` packages, outside the scan.

## Naming and structure

- Test class `XxxTest` for unit, `XxxIT` or `XxxIntegrationTest` for container-backed tests.
- Test methods describe behavior: `returnsEmptyWhenNoMatch`, not `test1`.
- One reason to fail per test; share setup through fixtures and builders in `src/test`, not through inheritance chains.
- Only message text inside tests is exempt from SC-CONST; the guard skips `src/test`, but fixture values used in several tests belong in constants or fixture files.
