Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `LogFields.java`.

```java
package {{sc:basePackage}}.common.logging;

import java.security.SecureRandom;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Names of the request-log fields (core-logging), plus the checks applied to ids that arrive from outside
 * (HTTP and message headers) before they go into MDC. Encoders write key-value pairs and MDC entries as JSON members.
 */
public final class LogFields {

    public static final String EVENT = "event";
    public static final String HTTP_IN = "http_in";
    public static final String HTTP_OUT = "http_out";
    public static final String MESSAGE_IN = "message_in";
    public static final String METHOD = "method";
    public static final String ROUTE = "route";
    public static final String URL = "url";
    public static final String TARGET = "target";
    public static final String STATUS = "status";
    public static final String DURATION_MS = "durationMs";
    public static final String ERROR = "error";
    public static final String REQ_BODY = "reqBody";
    public static final String RES_BODY = "resBody";

    /** MDC keys; traceId and spanId come from Micrometer Tracing. */
    public static final String REQUEST_ID = "requestId";
    public static final String USER_ID = "userId";
    public static final String TENANT_ID = "tenantId";
    public static final String SUPPORT_CODE = "supportCode";

    /** Header names shared by HTTP and messages. */
    public static final String REQUEST_ID_HEADER = "x-request-id";
    public static final String TENANT_ID_HEADER = "x-tenant-id";
    public static final String USER_ID_HEADER = "x-user-id";
    /** Response only: a support code is never read from a request. */
    public static final String SUPPORT_CODE_HEADER = "x-support-code";

    /** Request attributes set by HttpLoggingFilter before the chain; the error envelope reads them from the request. */
    public static final String REQUEST_ID_ATTRIBUTE = LogFields.class.getName() + ".requestId";
    public static final String SUPPORT_CODE_ATTRIBUTE = LogFields.class.getName() + ".supportCode";

    /** A message-header request id from outside is kept only when it is short and plain. */
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    /** A tenant or user id from outside: visible ASCII only (no spaces, no CR/LF), at most 128 characters. */
    private static final Pattern SAFE_ID = Pattern.compile("\\p{Graph}{1,128}");

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int SUPPORT_CODE_LENGTH = 6;

    private LogFields() {}

    /** The caller's HTTP request id when it parses as a UUID (returned in canonical form), else a new random UUID. */
    public static String requestIdOrNew(String incoming) {
        if (incoming != null && incoming.length() == 36) {
            try {
                return UUID.fromString(incoming).toString();
            } catch (IllegalArgumentException notAUuid) {
                // falls through to a new id
            }
        }
        return UUID.randomUUID().toString();
    }

    /** Six letters A-Z, drawn unbiased with SecureRandom.nextInt(26). A new one per request, never read from a header. */
    public static String newSupportCode() {
        StringBuilder code = new StringBuilder(SUPPORT_CODE_LENGTH);
        for (int i = 0; i < SUPPORT_CODE_LENGTH; i++) {
            code.append((char) ('A' + RANDOM.nextInt(26)));
        }
        return code.toString();
    }

    /** For message headers: the sender's request id when it is safe to log, else a new UUID. HTTP uses requestIdOrNew. */
    public static String safeRequestIdOrNew(String incoming) {
        return incoming != null && SAFE_REQUEST_ID.matcher(incoming).matches() ? incoming : UUID.randomUUID().toString();
    }

    /** A tenant or user id when it is safe to log and use, else null (treated as absent: fail closed). */
    public static String safeIdOrNull(String incoming) {
        return incoming != null && SAFE_ID.matcher(incoming).matches() ? incoming : null;
    }

    /**
     * The last resort when the logging backend itself throws, even for the fallback line: a warning on the JDK
     * platform logger, with the fallback's failure suppressed into the first. It never throws, also when that logger
     * is bridged to the same failing backend (Spring Boot routes java.util.logging to SLF4J), so a request or an
     * outbound call keeps its own outcome.
     */
    public static void warnLineNotWritten(String event, RuntimeException failure, RuntimeException fallbackFailure) {
        try {
            if (fallbackFailure != failure) { // a backend may rethrow one instance, and self-suppression throws
                failure.addSuppressed(fallbackFailure);
            }
            System.getLogger(LogFields.class.getName()).log(System.Logger.Level.WARNING, event + " line not written", failure);
        } catch (RuntimeException bridgedToTheSameBackend) {
            // nothing is left to write to; the request or the call is unaffected
        }
    }
}
```
