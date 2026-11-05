// Summarises a failure from the client for an SDK error message: the XRPC error code, the message
// and, when the message is generic, the message of its `cause`. Request headers (and with them the
// session's credentials) are never read; @atproto/lex errors do not hold them. A cause message
// comes from the runtime or the application's own fetch handler. The original error stays
// reachable as `cause`.
//
// Duck-typed rather than `instanceof XrpcError` so it works when the application has more than one
// copy of @atproto/lex (see `assertClient` in context.ts).
//
// A schema validation error (it has `issues`) is described by its issues alone, as "<what is wrong>
// at $.<path>"; an issue about the value itself has no path to point at, so " at $." is left out.
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if ("issues" in error && Array.isArray(error.issues)) {
    return error.issues
      .map((issue: { path: readonly unknown[]; message: string; toString(): string }) =>
        issue.path.length === 0 ? issue.message : issue.toString(),
      )
      .join(", ");
  }
  const code = "error" in error && typeof error.error === "string" ? error.error : undefined;
  const message =
    code === undefined || error.message === code ? error.message : `${code}: ${error.message}`;
  // Client-side failures (network errors, a request the client could not build) are reported with
  // a generic message and the real reason in `cause`.
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  return cause && !message.includes(cause) ? `${message}: ${cause}` : message;
}

// Whether the failure is the XRPC error a PDS returns when a record does not exist.
export function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    error.error === "RecordNotFound"
  );
}

// Names what the caller passed, for "but received ..." in error messages, without printing the
// value itself (it may be a session or other object holding credentials).
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return `a ${typeof value}`;
  const name = value.constructor?.name;
  return name && name !== "Object" ? `an object of type ${name}` : "a plain object";
}
