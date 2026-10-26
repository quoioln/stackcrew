Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `LogFields.java`.

```java
package {{sc:basePackage}}.common.logging;

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

    /** Header names shared by HTTP and messages. */
    public static final String REQUEST_ID_HEADER = "x-request-id";
    public static final String TENANT_ID_HEADER = "x-tenant-id";
    public static final String USER_ID_HEADER = "x-user-id";

    /** A request id from outside is kept only when it is short and plain. */
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    /** A tenant or user id from outside: visible ASCII only (no spaces, no CR/LF), at most 128 characters. */
    private static final Pattern SAFE_ID = Pattern.compile("\\p{Graph}{1,128}");

    private LogFields() {}

    /** The caller's request id when it is safe to log, else a new UUID. */
    public static String safeRequestIdOrNew(String incoming) {
        return incoming != null && SAFE_REQUEST_ID.matcher(incoming).matches() ? incoming : UUID.randomUUID().toString();
    }

    /** A tenant or user id when it is safe to log and use, else null (treated as absent: fail closed). */
    public static String safeIdOrNull(String incoming) {
        return incoming != null && SAFE_ID.matcher(incoming).matches() ? incoming : null;
    }
}
```
