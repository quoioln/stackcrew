package {{sc:basePackage}}.common.context;

/**
 * Cross-tenant access refused: runCrossTenant without a cross-tenant role, or a row of another tenant loaded by id.
 * Map it to the same 404 ProblemDetail as a missing row, with a constant detail: a 403 would confirm that another
 * tenant's id exists. Never echo the message to the client.
 */
public class CrossTenantDeniedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public CrossTenantDeniedException(String detail) {
        super("cross-tenant access denied: " + detail);
    }
}
