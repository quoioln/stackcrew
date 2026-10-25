---
name: stackcrew-spring-boot-testing
description: Use when writing or fixing tests for a Spring Boot service: JUnit 5 and AssertJ unit tests, WebMvcTest and DataJpaTest slices, Testcontainers for the database, WireMock for third-party providers.
kind: testing
---
# Write tests (Spring Boot 3)

Pick the narrowest test that proves the behavior. List the cases first, including at least three negative or edge cases per happy path.

## 1. Choose the test type

| Subject | Test | Notes |
|---|---|---|
| Domain or service logic | plain JUnit 5 + AssertJ | Mockito for ports only |
| Controller | `@WebMvcTest` | `MockMvc`, mock the service |
| Repository or query | `@DataJpaTest` + Testcontainers | real database, real migrations |
| Provider adapter | `@WireMockTest` | one class per adapter |
| Wiring, a few critical paths | `@SpringBootTest` | keep these few |
| Architecture | `StackcrewArchitectureTest` | generated, do not edit |

## 2. Unit test shape

```java
class VerificationServiceTest {
    private final ProviderPort provider = mock(ProviderPort.class);
    private final Clock clock = Clock.fixed(Instant.parse("2025-01-01T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void rejectsWhenProviderReturnsNoMatch() {
        // Arrange: the registry keys providers by code(), so stub it before building the registry
        when(provider.code()).thenReturn(ProviderCodes.C06);
        when(provider.verify(any())).thenReturn(new VerifyResult(VerificationStatus.REJECTED, BigDecimal.ZERO, "ref-1"));
        var service = new VerificationService(new ProviderRegistry(List.of(provider)), clock);

        // Act
        Verification result = service.create(COMMAND);

        // Assert
        assertThat(result.status()).isEqualTo(VerificationStatus.REJECTED);
    }
}
```

- Arrange-Act-Assert, one reason to fail, a behavior-describing name.
- Inject a `Clock`; no `Thread.sleep` (use Awaitility); no dependence on test order.
- Never mock the class under test, records or value objects. Build them.

## 3. Provider adapters with WireMock

- Use `@WireMockTest` and point the adapter's `RestClient` at `wm.getHttpBaseUrl()`.
- Resilience4j is applied in the adapter's template, so build the adapter by hand with `CircuitBreakerRegistry` and `RetryRegistry` (a short `waitDuration`, `retryExceptions(ProviderUnavailableException.class)`, `ignoreExceptions(ProviderRejectedException.class, ProviderProtocolException.class)`) and short client timeouts. No Spring context is needed.
- Cases: success, 4xx (one request, no retry), 5xx, timeout (`withFixedDelay`), malformed body, retry scenario (fail then succeed), duplicate callback.
- Assert the domain result and typed exception; assert no provider record type appears in the public signature.
- Response fixtures live in `src/test/resources/<provider>/`.

## 4. Database tests

- `@DataJpaTest` with `@AutoConfigureTestDatabase(replace = NONE)` and a Testcontainers `@ServiceConnection` container of the production engine. No H2 stand-in.
- Cover constraints, optimistic locking and pagination queries.

## 5. Controller tests

- Cover validation failure (400 and a `ProblemDetail` body), not found, forbidden, and the happy path with the exact response record.
- Use `@MockitoBean` on Spring Boot 3.4+, `@MockBean` before that.

## 6. Before you finish

- Run the tests and report the real result. Do not claim green without running them.
- Every assertion checks real behavior; no empty `assertThat(x).isNotNull()` as the only check.
- Only message text inside tests is exempt from SC-CONST (the guard skips `src/test`); fixture values used in several tests belong in constants or fixture files.

## Do not

- Do not call real providers or real network hosts from tests.
- Do not use H2 to emulate production database behavior.
- Do not use `@SpringBootTest` where a slice would do.
- Do not add `JsonNode` or `Map<String, Object>` to tests to dodge writing a record; build the typed request.
