package {{sc:basePackage}}.common.logging;

/** Names of the request-log fields (core-logging). Encoders write key-value pairs and MDC entries as JSON members. */
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

    private LogFields() {}
}
