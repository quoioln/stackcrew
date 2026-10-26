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
| `HttpLoggingFilter.java` | `OncePerRequestFilter` with `ContentCachingRequestWrapper` and `ContentCachingResponseWrapper`: one `http_in` line, MDC `requestId`, `userId`, `tenantId`. |
| `LoggingClientInterceptor.java` | `ClientHttpRequestInterceptor`: one `http_out` line per outbound call. |
| `LoggingConfig.java` | The beans; keeps the filter out of the plain servlet chain. |

`HttpLoggingFilter` reads `userId` and `tenantId` through `TenantContext` (skill `stackcrew-spring-jpa-entity`); create that first if it is missing.

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
                .oauth2ResourceServer(server -> server.jwt(Customizer.withDefaults()))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(AbstractHttpConfigurer::disable)
                .addFilterAfter(httpLogging, BearerTokenAuthenticationFilter.class)
                .build();
    }
}
```

- `addFilterAfter(..., BearerTokenAuthenticationFilter.class)`: the filter runs after authentication, so its MDC (`requestId`, `userId`, `tenantId`) is on every line of the request, and before `ExceptionTranslationFilter`, so 401 and 403 answers still get their line. A request with an invalid or expired token is rejected inside `BearerTokenAuthenticationFilter` and gets no `http_in` line.
- `LoggingConfig` disables the automatic servlet registration of the filter bean; keep that, or it runs outside the security chain without a user.
- The line: `event=http_in`, `method`, `route` (the templated pattern such as `/verifications/{id}`, `UNMATCHED` when no handler matched), `status`, `durationMs`, `reqBody`, `resBody`, and `error` with the exception class when one escaped (logged as 500). INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx. `traceId` and `spanId` come from Micrometer Tracing's MDC.
- `copyBodyToResponse()` runs in `finally`: without it the client gets an empty body.
- Async handlers (`Callable`, `DeferredResult`) log once, when the async dispatch completes. `/actuator` and `text/event-stream` requests are skipped: a caching wrapper would hold an SSE stream back.
- Request bodies are cached up to 2 MiB so a base64 image can be measured; larger ones, and bodies the handler never read, log `<CT N bytes>` from `Content-Length`.
- A caller's `x-request-id` is kept only when it is short and plain (`[A-Za-z0-9._-]{1,64}`); otherwise a new UUID is used.

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
- `target` is the service or provider code. The line: `event=http_out`, `target`, `method`, `url` (scheme, host, port and path; no query string, no user info), `status`, `durationMs`, `reqBody`, `resBody`, or `error` with the exception class on an I/O failure.
- On Boot 3.0 and 3.1 (no `RestClient`), add the same interceptor to `RestTemplateBuilder` with `.requestFactory(() -> new BufferingClientHttpRequestFactory(...))`.
- Adapters, services and controllers never log bodies themselves.

## 6. Message consumers

Log one `message_in` line per message through the same masker, after setting the context from the headers `x-tenant-id`, `x-user-id`, `x-request-id`:

```java
log.atInfo().setMessage(LogFields.MESSAGE_IN)
        .addKeyValue(LogFields.EVENT, LogFields.MESSAGE_IN)
        .addKeyValue(LogFields.REQ_BODY, masker.mask(payload, contentType))
        .log();
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
    void logsAPlaceholderForContentItCannotMask() {
        assertThat(masker.mask(new byte[300], "text/xml")).isEqualTo("<text/xml 300 bytes>");
        assertThat(masker.mask("{bad".getBytes(StandardCharsets.UTF_8), JSON)).isEqualTo("<application/json 4 bytes>");
        assertThat(masker.mask(new byte[5000], "image/jpeg")).isEqualTo("<binary image/jpeg 5000 bytes>");
        assertThat(masker.mask("email=a%40b.c&amount=10".getBytes(StandardCharsets.UTF_8), "application/x-www-form-urlencoded"))
                .isEqualTo("{\"email\":\"***\",\"amount\":\"10\"}");
    }
}
```

Plus one `@SpringBootTest(webEnvironment = RANDOM_PORT)` test that sends a body with a password through a real request and asserts exactly one `http_in` event with `"***"` in `reqBody` and the original body at the client, and one for an outbound call (a stub server or WireMock) that asserts one `http_out` event and a URL without its query string. Capture the events with a Logback `ListAppender` on the two loggers and read `getKeyValuePairs()` and `getMDCPropertyMap()`.

## Do not

- Do not log a body anywhere else: no `log.info(request.toString())`, no body in an exception message, no second masker.
- Do not log headers other than `content-type`, `content-length` and `user-agent`; never `Authorization` or cookies.
- Do not add the interceptor to a client without the buffering factory.
- Do not register `HttpLoggingFilter` as a plain servlet filter as well as in the security chain.
- Do not cache streaming responses (SSE, file downloads): exclude them in `shouldNotFilter`.
