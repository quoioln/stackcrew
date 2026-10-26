---
name: stackcrew-spring-request-logging
description: Use when setting up or changing HTTP request and response logging in a Spring Boot service: the shared body masker and its app.logging settings, the inbound filter, the RestClient interceptor for outbound calls, message consumer lines, and their tests.
kind: task
---
# Masked request and response logging (Spring Boot 3)

Implements `core-logging` ("Request and response logging", "Body masker"): one line per HTTP call, inbound and outbound, with both bodies after one shared masker. Write the SC-PREFLIGHT note first: which of the classes below, a request-id or MDC filter, and a logging `RestTemplate`/`RestClient` interceptor already exist.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `BodyMasker`, `HttpLoggingFilter`, `LoggingClientInterceptor` and any filter that fills MDC. Extend what exists; replace a filter that logs bodies without masking. Create the missing pieces once, in `{{sc:basePackage}}.common.logging` by default, from the files next to this skill:

| File | What it does |
|---|---|
| `MaskingProperties.java` | `@ConfigurationProperties("app.logging")`: `mask-fields`, `max-body-bytes`, `log-bodies`. |
| `BodyMasker.java` | The masker: `String mask(byte[] body, String contentType)` and `placeholder(contentType, size)`. |
| `LogFields.java` | Field, MDC and header names (`event`, `reqBody`, `requestId`, `x-tenant-id`...). |
| `HttpLoggingFilter.java` | `OncePerRequestFilter` with `ContentCachingRequestWrapper` and the response wrapper below: one `http_in` line, MDC `requestId`, `userId`, `tenantId`; its nested `UserMdc` filter fills the user after authentication. |
| `TeeResponseWrapper.java` | Write-through response wrapper: every byte and header goes straight to the client; a JSON or form body is also copied, up to 2 MiB, for masking; everything else is only counted. |
| `LoggingClientInterceptor.java` | `ClientHttpRequestInterceptor`: one `http_out` line per outbound call. |
| `LoggingConfig.java` | The beans; keeps the filter out of the plain servlet chain. |

The filter reads `userId` (JWT `sub`) and `tenantId` (claim `{{sc:tenantClaim}}`) from the `Jwt` in Spring Security's context, so it needs no JPA. Message consumers also use `TenantContext` from `stackcrew-spring-jpa-entity` (section 6).

## 2. Configuration

```yaml
app:
  logging:
    mask-fields: []              # PII keys; empty or unset = BodyMasker.DEFAULT_PII_FIELDS. Secrets are always masked.
    max-body-bytes: 16384        # cap after masking
    log-bodies: true             # false drops reqBody and resBody, keeps the line
logging:
  pattern:
    console: "%d{HH:mm:ss.SSS} %-5level [%X{requestId:-}] %logger{36} - %msg %kvp%n"   # local text: %kvp prints the fields
```

- The fields are SLF4J key-value pairs (`log.atInfo().addKeyValue(...)`). JSON output writes them as members: `logging.structured.format.console=logstash` on Boot 3.4+, `LogstashEncoder` (logstash-logback-encoder 7.x) before that. Boot's default text pattern does not print them; add `%kvp` as above.
- A configured `mask-fields` list replaces the default PII list. Changing it never unmasks a secret key.

## 3. The masker contract

`BodyMasker` implements the `core-logging` table; do not write a second masker or mask by hand.

- Keys split into words on camelCase, `_`, `-` and spaces; a key is masked when any contiguous run of its words is in the list. `newPassword`, `ACCESS_TOKEN`, `customerEmail`, `national_id` are masked; `shipping`, `spanId`, `pinned`, `typeName` are not. Values of masked keys become `"***"`, objects and arrays included.
- A string over 1024 characters that is base64 (or a `data:` URI) becomes `<base64 N bytes>`.
- After masking the body is serialized compactly; above `max-body-bytes` it keeps the first bytes (cut on a character) and appends `...[truncated T bytes]`.
- JSON (`application/json`, `*+json`) and form bodies are parsed and masked. `multipart/*`, `application/octet-stream`, `image/*`, `application/pdf` log `<binary CT N bytes>`; anything else (XML, SOAP, text, unparseable JSON, no content type) logs `<CT N bytes>`. CT is the media type without parameters, `unknown` when missing. An empty body logs no field.

## 4. Inbound: the filter in the security chain

```java
@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http, HttpLoggingFilter httpLogging) throws Exception {
        return http
                .authorizeHttpRequests(requests -> requests.anyRequest().authenticated())
                .cors(Customizer.withDefaults())                              // the CORS allowlist (rules: Security)
                .oauth2ResourceServer(server -> server.jwt(Customizer.withDefaults()))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(AbstractHttpConfigurer::disable)
                .addFilterBefore(httpLogging, CorsFilter.class)
                .addFilterAfter(new HttpLoggingFilter.UserMdc(), BearerTokenAuthenticationFilter.class)
                .build();
    }
}
```

- `addFilterBefore(..., CorsFilter.class)`: the filter runs before CORS and authentication, so every request gets its line, including a 403 for a disallowed origin, a 401 for an invalid or expired token, and a 403 from authorization. The security context is still filled when the line is written, so the line carries `userId` and `tenantId` when the caller was authenticated. `CorsFilter` is `org.springframework.web.filter.CorsFilter`; the position holds even without `.cors(...)`.
- `HttpLoggingFilter.UserMdc` after `BearerTokenAuthenticationFilter` puts `userId` and `tenantId` in MDC for every log line of the request and removes them in `finally`. `HttpLoggingFilter` removes `requestId`, `userId` and `tenantId` in an outer `finally`, so a client abort cannot leave them on a pooled thread.
- `LoggingConfig` disables the automatic servlet registration of the filter bean; keep that, or it runs outside the security chain.
- The line: `event=http_in`, `method`, `route` (the templated pattern such as `/verifications/{id}`, `UNMATCHED` when no handler matched), `status`, `durationMs`, `reqBody`, `resBody`, and `error` with the exception class when one escaped (logged as 500). INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx. `traceId` and `spanId` come from Micrometer Tracing's MDC.
- Async handlers (`Callable`, `DeferredResult`, SSE, `StreamingResponseBody`) log once, when the async dispatch completes. Only `/actuator` is skipped.
- The response is never held back. `TeeResponseWrapper` writes every byte and header straight to the client, so `Content-Length`, `Content-Disposition`, flushes and SSE behave as without logging, at any size. Only a JSON, `*+json` or form body of a non-streaming request is also copied (up to 2 MiB) and masked. Everything else (images, PDF, zip, video, CSV, octet-stream, SSE, `StreamingResponseBody`, bodies above 2 MiB) logs `<CT N bytes>` or `<binary CT N bytes>` with the counted size. The choice is made at the first write, when the content type is set.
- Request bodies are cached up to 2 MiB so a base64 image can be measured; larger ones, and bodies the handler never read, log `<CT N bytes>` from `Content-Length` (a `long`).
- A caller's `x-request-id` is kept only when it is short and plain (`LogFields.safeRequestIdOrNew`); otherwise a new UUID is used.

## 5. Outbound: one interceptor per client, on a buffering factory

```java
var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(connectTimeout).build());
factory.setReadTimeout(readTimeout);
RestClient client = builder.clone().baseUrl(baseUrl)
        .requestFactory(new BufferingClientHttpRequestFactory(factory))
        .requestInterceptor(new LoggingClientInterceptor(ProviderCodes.C06, masker))
        .build();
```

- `BufferingClientHttpRequestFactory` is required: the interceptor reads the response body to log it, and without buffering the caller then reads an empty body. Set it after any other `requestFactory(...)` call on the builder, since the last one wins.
- `target` is the service or provider code. The line: `event=http_out`, `target`, `method`, `url` (scheme, host, port and path; no query string, no user info), `status`, `durationMs`, `reqBody`, `resBody`, or `error` with the exception class on an I/O failure. A response body that breaks off while it is read still gives one line, with the status and `error` and no `resBody`.
- On Boot 3.0 and 3.1 (no `RestClient`), add the same interceptor to `RestTemplateBuilder` with `.requestFactory(() -> new BufferingClientHttpRequestFactory(...))`.
- Adapters, services and controllers never log bodies themselves.

## 6. Message consumers

Producers send the headers `x-request-id`, `x-tenant-id` and `x-user-id` (`LogFields.*_HEADER`). A consumer checks them (`LogFields.safeRequestIdOrNew`, `safeIdOrNull`: an unsafe tenant or user counts as absent), puts them in MDC, logs one `message_in` line with the payload through the same masker, runs the handler inside `TenantContext.runAs` (skill `stackcrew-spring-jpa-entity`), and clears MDC on every exit path. `runAs` never grants the system identity, so `x-user-id: {{sc:systemUser}}` cannot read across tenants. The Kafka version is in `stackcrew-spring-kafka-consumer` (`ConsumerMdc`); any other broker follows the same shape:

```java
void onMessage(String payload, String requestIdHeader, String tenantIdHeader, String userIdHeader) {
    String tenantId = LogFields.safeIdOrNull(tenantIdHeader);
    String userId = LogFields.safeIdOrNull(userIdHeader);
    MDC.put(LogFields.REQUEST_ID, LogFields.safeRequestIdOrNew(requestIdHeader));
    if (tenantId != null) { MDC.put(LogFields.TENANT_ID, tenantId); }
    if (userId != null) { MDC.put(LogFields.USER_ID, userId); }
    try {
        LoggingEventBuilder line = log.atInfo().setMessage(LogFields.MESSAGE_IN).addKeyValue(LogFields.EVENT, LogFields.MESSAGE_IN);
        if (masker.logBodies() && payload != null) {               // a tombstone (null payload) has no body to log
            line = line.addKeyValue(LogFields.REQ_BODY,
                    masker.mask(payload.getBytes(StandardCharsets.UTF_8), MediaType.APPLICATION_JSON_VALUE));
        }
        line.log();
        // codec.read rejects a null payload with a non-retryable InvalidEventException, as EventCodec.read does
        TenantContext.runAs(tenantId, userId, () -> handler.handle(codec.read(payload)));
    } finally {
        MDC.remove(LogFields.REQUEST_ID);
        MDC.remove(LogFields.TENANT_ID);
        MDC.remove(LogFields.USER_ID);
    }
}
```
## 7. Tests

The masker contract, as a plain JUnit test (no Spring):

```java
class BodyMaskerTest {
    private static final String JSON = "application/json";
    private final BodyMasker masker = new BodyMasker(MaskingProperties.defaults());

    private String mask(BodyMasker m, String json) {
        return m.mask(json.getBytes(StandardCharsets.UTF_8), JSON);
    }

    @ParameterizedTest
    @ValueSource(strings = {"password", "newPassword", "confirm_password", "ACCESS_TOKEN", "access-token", "tokenType",
        "Authorization", "set-cookie", "otp", "pin", "cvv", "email", "customerEmail", "phoneNumber", "mobile", "fullName",
        "dateOfBirth", "homeAddress", "national_id", "nationalIdNumber", "cccd", "passportNumber", "cardNumber", "accountNumber"})
    void masksSecretAndPiiKeys(String key) {
        assertThat(mask(masker, "{\"" + key + "\":\"v\"}")).isEqualTo("{\"" + key + "\":\"***\"}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"shipping", "company", "spanId", "footprint", "pinned", "id", "orderId", "amount", "status", "name", "typeName"})
    void keepsKeysWithoutAListedWord(String key) {
        assertThat(mask(masker, "{\"" + key + "\":\"v\"}")).isEqualTo("{\"" + key + "\":\"v\"}");
    }

    @Test
    void configuredPiiListReplacesTheDefaultButNeverTheSecrets() {
        var onlyEmail = new BodyMasker(new MaskingProperties(List.of("email"), MaskingProperties.DEFAULT_MAX_BODY_BYTES, true));
        assertThat(mask(onlyEmail, "{\"email\":\"a\",\"phoneNumber\":\"b\",\"password\":\"c\"}"))
                .isEqualTo("{\"email\":\"***\",\"phoneNumber\":\"b\",\"password\":\"***\"}");
        var profile = new BodyMasker(new MaskingProperties(List.of("profile"), MaskingProperties.DEFAULT_MAX_BODY_BYTES, true));
        assertThat(mask(profile, "{\"profile\":{\"x\":1}}")).isEqualTo("{\"profile\":\"***\"}");
    }

    @Test
    void masksNestedObjectsAndArrays() {
        assertThat(mask(masker, "{\"customer\":{\"contact\":{\"phone\":\"0901\"}},\"items\":[{\"cardNumber\":\"4111\"}]}"))
                .isEqualTo("{\"customer\":{\"contact\":{\"phone\":\"***\"}},\"items\":[{\"cardNumber\":\"***\"}]}");
    }

    @Test
    void replacesBase64LongerThan1024CharsWithItsSize() {
        String exactly1024 = "A".repeat(1024);
        assertThat(mask(masker, "{\"img\":\"" + exactly1024 + "\"}")).isEqualTo("{\"img\":\"" + exactly1024 + "\"}");
        assertThat(mask(masker, "{\"img\":\"" + "A".repeat(1028) + "\"}")).isEqualTo("{\"img\":\"<base64 771 bytes>\"}");
    }

    @Test
    void truncatesAfter16384Bytes() {
        String exact = "{\"n\":\"" + "a b ".repeat(4094) + "\"}";
        assertThat(exact.getBytes(StandardCharsets.UTF_8)).hasSize(16384);
        assertThat(mask(masker, exact)).isEqualTo(exact);
        String over = "{\"n\":\"" + "a b ".repeat(4094) + "c\"}";
        assertThat(mask(masker, over)).isEqualTo(over.substring(0, 16384) + "...[truncated 16385 bytes]");
    }

    @Test
    void cutsOnACharacterBoundary() {
        String body = "{\"n\":\"" + "a-".repeat(8188) + "a\u00e9\"}";   // the 2-byte \u00e9 sits on bytes 16383 and 16384
        assertThat(body.getBytes(StandardCharsets.UTF_8)).hasSize(16387);
        assertThat(mask(masker, body)).isEqualTo(body.substring(0, 16383) + "...[truncated 16387 bytes]");
    }

    @Test
    void logsAPlaceholderForContentItCannotMask() {
        assertThat(masker.mask(new byte[300], "text/xml")).isEqualTo("<text/xml 300 bytes>");
        assertThat(masker.mask("{bad".getBytes(StandardCharsets.UTF_8), JSON)).isEqualTo("<application/json 4 bytes>");
        assertThat(masker.mask(new byte[5000], "image/jpeg")).isEqualTo("<binary image/jpeg 5000 bytes>");
        assertThat(masker.mask("email=a%40b.c&amount=10".getBytes(StandardCharsets.UTF_8), "application/x-www-form-urlencoded"))
                .isEqualTo("{\"email\":\"***\",\"amount\":\"10\"}");
    }
}
```

Plus `@SpringBootTest(webEnvironment = RANDOM_PORT)` tests through real requests. Capture the events with a Logback `ListAppender` on the two loggers and read `getKeyValuePairs()` and `getMDCPropertyMap()`. The response reaches the client before the filter writes its line, so wait for the line (Awaitility `await().untilAsserted(...)`) instead of asserting right after the call. Cover:
- a body with a password gives exactly one `http_in` event with `"***"` in `reqBody`, while the client gets the original body;
- an invalid token gives a 401 with one `http_in` line, a disallowed origin a 403 with one line, and a valid token a line with `userId`;
- an SSE, image or download endpoint logs a size placeholder and reaches the client unbuffered, with its `Content-Length`;
- an outbound call through a stub server or WireMock gives one `http_out` event with a URL without its query string.

## Do not

- Do not log a body anywhere else: no `log.info(request.toString())`, no body in an exception message, no second masker.
- Do not log headers other than `content-type`, `content-length` and `user-agent`; never `Authorization` or cookies.
- Do not add the interceptor to a client without the buffering factory.
- Do not register `HttpLoggingFilter` as a plain servlet filter as well as in the security chain.
- Do not replace `TeeResponseWrapper` with `ContentCachingResponseWrapper`: it holds every response in memory, defers headers until `copyBodyToResponse()`, and SSE events and downloads then wait until the response ends.
