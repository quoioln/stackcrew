Goes to `src/shared/action-result.ts`.

```ts
// Default location: src/shared/action-result.ts
/** Why a server action refused: a closed list, so the client can branch on it and the log line can rank it. */
export const ActionErrorCode = {
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
} as const;
export type ActionErrorCode = (typeof ActionErrorCode)[keyof typeof ActionErrorCode];

/** A refusal the client can show: the code, and per-field messages for VALIDATION (from zod's flatten()). */
export type ActionError = { code: ActionErrorCode; fieldErrors?: Partial<Record<string, string[]>> };

/** What every server action returns: serializable data (a DTO, never an entity) or a typed refusal. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/**
 * The status each refusal stands for on the action's http_in line, so the line's level and alerts work as for a route
 * handler (WARN for 4xx). The HTTP response of an action is 200 whatever it returns.
 */
export const ACTION_ERROR_STATUS: Readonly<Record<ActionErrorCode, number>> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: ActionErrorCode, fieldErrors?: Partial<Record<string, string[]>>): ActionResult<T> {
  return { ok: false, error: fieldErrors === undefined ? { code } : { code, fieldErrors } };
}

/** True for a refusal of any action: the logging wrapper reads the code from it without knowing the action. */
export function isActionFailure(value: unknown): value is { ok: false; error: ActionError } {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== false || !('error' in value)) {
    return false;
  }
  const error: unknown = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && error.code in ACTION_ERROR_STATUS;
}
```
