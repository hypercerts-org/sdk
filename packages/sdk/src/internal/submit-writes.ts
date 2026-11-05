import type { DidString } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError } from "./describe.js";
import type { PreparedRecord } from "./prepare-record.js";
import type { StrongRef } from "./resolve-record-ref.js";

/**
 * Base class of the errors thrown when the single request that creates records did not succeed.
 * Check `instanceof` against {@link WriteRejectedError}, {@link WriteOutcomeUnknownError} and
 * {@link WriteResultMismatchError} to tell them apart.
 */
export abstract class WriteError extends Error {
  /** The URI and CID of every record the failed request tried to create, in request order. */
  readonly attempted: readonly StrongRef[];

  constructor(message: string, attempted: readonly StrongRef[], options?: ErrorOptions) {
    super(message, options);
    this.attempted = attempted;
  }
}

/**
 * The PDS answered with a client error (HTTP 4xx) and so did not create any of the records. The
 * request can be corrected and sent again; nothing needs cleaning up.
 *
 * `status` and `code` are the HTTP status and the XRPC error code (for example `InvalidRequest`).
 * `cause` is the client's original error.
 */
export class WriteRejectedError extends WriteError {
  override readonly name = "WriteRejectedError";
  readonly status: number;
  readonly code: string | undefined;

  constructor(
    message: string,
    attempted: readonly StrongRef[],
    details: { status: number; code: string | undefined },
    options?: ErrorOptions,
  ) {
    super(message, attempted, options);
    this.status = details.status;
    this.code = details.code;
  }
}

/**
 * No usable answer came back (network failure, timeout, a server error or an unreadable response),
 * so it is not known whether the PDS created the records. `attempted` lists every URI that may
 * now exist.
 *
 * The SDK does not retry. Retrying with new record keys would duplicate every record if the first
 * attempt had succeeded.
 */
export class WriteOutcomeUnknownError extends WriteError {
  override readonly name = "WriteOutcomeUnknownError";
}

/**
 * The PDS created the records but reported different URIs or CIDs than the SDK computed. Records
 * that were written with references to each other (an Activity and its rights, for example) may
 * therefore point at CIDs that do not match what is stored. `attempted` holds the references the
 * SDK computed and `reported` the ones the PDS returned, both in request order.
 */
export class WriteResultMismatchError extends WriteError {
  override readonly name = "WriteResultMismatchError";
  readonly reported: readonly StrongRef[];

  constructor(message: string, attempted: readonly StrongRef[], reported: readonly StrongRef[]) {
    super(message, attempted);
    this.reported = reported;
  }
}

/**
 * Creates all `records` in `did`'s repo with one `com.atproto.repo.applyWrites` request, which the
 * PDS applies as a single commit: every record is created or none is.
 *
 * Internal. Boundaries:
 * - Never retries and never splits the request; the caller decides what to do about a failure.
 * - Does not pass `validate`, so the PDS applies its own default; records are validated by the
 *   builders against their lexicons before they get here.
 * - Classifies a failure as definite only when the PDS answered with an HTTP 4xx other than 408.
 *   Everything else, including a 2xx whose body the client could not read, is outcome-unknown.
 * - Compares the PDS's reported URIs and CIDs with the computed ones, because records already
 *   reference each other by CID.
 *
 * Throws WriteRejectedError, WriteOutcomeUnknownError or WriteResultMismatchError. `operation`
 * names the public function for the message.
 */
export async function submitWrites(
  context: SDKContext,
  did: DidString,
  records: readonly PreparedRecord[],
  operation: string,
): Promise<void> {
  const attempted = records.map((record) => record.ref);
  let results: readonly unknown[] | undefined;
  try {
    const response = await context.client.applyWrites(
      () =>
        records.map(({ collection, rkey, value }) => ({
          $type: "com.atproto.repo.applyWrites#create" as const,
          collection,
          rkey,
          value,
        })),
      { repo: did },
    );
    results = response.body.results;
  } catch (error) {
    throw classifyFailure(operation, error, attempted);
  }
  assertReportedRefs(operation, attempted, results);
}

function classifyFailure(operation: string, error: unknown, attempted: readonly StrongRef[]) {
  const status = property(error, "status");
  const code = property(error, "error");
  const reason = describeError(error);
  const records = attempted.length === 1 ? "the record" : `the ${attempted.length} records`;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) {
    return new WriteRejectedError(
      `${operation}: the PDS rejected the request (HTTP ${status}: ${reason}), so ${records} ${attempted.length === 1 ? "was" : "were"} not created. ` +
        "Nothing needs cleaning up. Fix the cause (for example the input, the session's permissions or a rate limit) and call again.",
      attempted,
      { status, code: typeof code === "string" ? code : undefined },
      { cause: error },
    );
  }
  return new WriteOutcomeUnknownError(
    `${operation}: no usable answer from the PDS (${reason}), so it is not known whether ${records} ${attempted.length === 1 ? "was" : "were"} created: ${attempted.map((ref) => ref.uri).join(", ")}. ` +
      `Check whether they exist (for example with com.atproto.repo.getRecord) before trying again. The SDK does not retry, because calling ${operation} again would create duplicates with new record keys if the first attempt succeeded.`,
    attempted,
    { cause: error },
  );
}

// Duck-typed rather than `instanceof XrpcResponseError`: see `assertClient` in context.ts. Only
// that class has a numeric `status`; an unreadable 2xx response (XrpcInvalidResponseError) does not.
function property(error: unknown, name: "status" | "error"): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

// `results` is optional in the response schema. A PDS that omits it is trusted; one that returns
// it must agree with the computed references.
function assertReportedRefs(
  operation: string,
  attempted: readonly StrongRef[],
  results: readonly unknown[] | undefined,
): void {
  if (results === undefined) return;
  const reported = results.map(toRef);
  const matches =
    reported.length === attempted.length &&
    reported.every((ref, i) => ref?.uri === attempted[i]?.uri && ref?.cid === attempted[i]?.cid);
  if (matches) return;
  throw new WriteResultMismatchError(
    `${operation}: the PDS created the records but reported different URIs or CIDs than the SDK computed, so references between the new records may not match what is stored. ` +
      `Computed: ${JSON.stringify(attempted)}. Reported: ${JSON.stringify(reported)}.`,
    attempted,
    reported.filter((ref) => ref !== undefined),
  );
}

function toRef(result: unknown): StrongRef | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const { uri, cid } = result as { uri?: unknown; cid?: unknown };
  return typeof uri === "string" && typeof cid === "string"
    ? ({ uri, cid } as StrongRef)
    : undefined;
}
