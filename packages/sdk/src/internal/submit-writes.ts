import type { DidString, NsidString, TypedLexMap } from "@atproto/lex";
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
  override readonly name: string = "WriteRejectedError";
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
 * A record this call would have created already exists at its key, so nothing was written and the
 * existing record is unchanged.
 *
 * @remarks
 * `uri` is the URI of the record that is in the way. Extends {@link WriteRejectedError}, so code
 * that handles any rejected write handles this too. `status` and `code` are what the reference PDS
 * answers for a taken key (HTTP `400`, `InvalidSwap`); they have the same values when the SDK finds
 * the record itself before sending anything, in which case `attempted` is empty.
 *
 * The record can be reused instead: pass its `uri` where the input accepts `{ uri }`.
 */
export class RecordAlreadyExistsError extends WriteRejectedError {
  override readonly name: string = "RecordAlreadyExistsError";
  readonly uri: string;

  constructor(
    message: string,
    uri: string,
    attempted: readonly StrongRef[],
    details: { status: number; code: string | undefined },
    options?: ErrorOptions,
  ) {
    super(message, attempted, details, options);
    this.uri = uri;
  }
}

/**
 * No usable answer came back (network failure, timeout, a server error or an unreadable response),
 * so it is not known whether the PDS created the records. `attempted` lists every URI that may
 * now exist.
 *
 * The SDK does not retry. Retrying with new record keys would duplicate every record if the first
 * attempt had succeeded. The exception is a record whose key is fixed or decided by its data and
 * that is only created if absent (`createProfile`, and `createVocabularyTag`, whose nested tags are
 * checked before the write): calling again either creates it or is refused because it already
 * exists, most likely from the first attempt, so it cannot duplicate.
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
 * The most writes one `applyWrites` request may hold. The reference PDS (`@atproto/pds`, checked in
 * 0.5.34 and 0.5.44) rejects a request with more with HTTP 400 "Too many writes. Max: 200"; the
 * lexicon states no limit.
 */
export const MAX_WRITES_PER_REQUEST = 200;

/**
 * Fails before anything is uploaded or written when a call would create more records than one
 * `applyWrites` request may hold.
 *
 * Internal. The SDK never splits a call into several requests: the records reference each other
 * and are committed together or not at all, which several requests could not guarantee.
 *
 * Throws TypeError, so the caller learns to shrink the input and that nothing was written.
 */
export function assertWithinWriteLimit(operation: string, count: number): void {
  if (count <= MAX_WRITES_PER_REQUEST) return;
  throw new TypeError(
    `${operation}: this call would create ${count} records, but one write holds at most ${MAX_WRITES_PER_REQUEST} (the reference PDS rejects more with "Too many writes. Max: ${MAX_WRITES_PER_REQUEST}"). ` +
      "The SDK does not split a call, because the records reference each other and must be committed together. " +
      "Nothing was written. Create some of the records first (for example with createVocabularyTag) and pass their URIs as { uri }, or pass fewer.",
  );
}

/**
 * Creates all `records` in `did`'s repo with one `com.atproto.repo.applyWrites` request, which the
 * PDS applies as a single commit: every record is created or none is.
 *
 * Internal. Boundaries:
 * - Never retries and never splits the request; the caller decides what to do about a failure.
 *   `retrySafe` says whether calling again after an unknown outcome cannot duplicate records
 *   (every record has a key the input decided, and the caller checks none exists before sending);
 *   it only changes the advice in the error message.
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
export function submitWrites(
  context: SDKContext,
  did: DidString,
  records: readonly PreparedRecord[],
  operation: string,
  retrySafe = false,
): Promise<void> {
  return submit(
    operation,
    records.map((record) => record.ref),
    async () => {
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
      return response.body.results;
    },
    retrySafe,
  );
}

/**
 * Creates one record at a record key that its lexicon fixes or its data decides, only if there is
 * no record at that key yet, with `com.atproto.repo.putRecord` and `swapRecord: null`.
 *
 * Internal. Used for records whose key can already be taken (see `fixedRecordKey`, and a kind's
 * `recordKey`). `applyWrites` cannot tell the caller so: the reference PDS answers a `create` at a
 * taken key with a generic HTTP 500, which is indistinguishable from a server fault. `putRecord`
 * with `swapRecord: null` is the lexicon's own "only if absent": the PDS checks it together with
 * the write, so concurrent calls cannot overwrite each other, and answers a taken key with HTTP
 * 400 `InvalidSwap`, which this reports as a RecordAlreadyExistsError (the only reason this
 * request can fail that way). Checked against the reference PDS only.
 *
 * Otherwise the same boundaries as `submitWrites`: no retries, the same failure classification,
 * and the reported URI and CID are compared with the computed ones. Unlike `submitWrites`, a
 * caller may safely call again after an unknown outcome: the key is the same and the write is only
 * made if absent, so a second call cannot duplicate the record.
 *
 * Throws RecordAlreadyExistsError when the key is taken, and otherwise WriteRejectedError,
 * WriteOutcomeUnknownError or WriteResultMismatchError.
 */
export async function submitCreateOnly(
  context: SDKContext,
  did: DidString,
  record: PreparedRecord,
  operation: string,
): Promise<void> {
  try {
    await submit(
      operation,
      [record.ref],
      async () => {
        const response = await context.client.putRecord(
          record.value as TypedLexMap<NsidString>,
          record.rkey,
          {
            repo: did,
            // The lexicon allows `null` ("must not exist yet"); the client's option type leaves it out.
            swapRecord: null as unknown as string,
          },
        );
        return [response.body];
      },
      true,
    );
  } catch (error) {
    throw error instanceof WriteRejectedError && error.code === "InvalidSwap"
      ? alreadyExists(operation, record.ref.uri, error)
      : error;
  }
}

function alreadyExists(
  operation: string,
  uri: string,
  rejected: WriteRejectedError,
): RecordAlreadyExistsError {
  return new RecordAlreadyExistsError(
    `${operation}: a record already exists at ${uri}, so nothing was written and the existing record is unchanged. ${operation} only creates records; it never overwrites one.`,
    uri,
    rejected.attempted,
    { status: rejected.status, code: rejected.code },
    { cause: rejected.cause },
  );
}

// Sends one write request and checks what it reports. `send` resolves to the PDS's results, one
// per record in request order, or `undefined` if the PDS reported none. `retrySafe` says whether
// calling again after an unknown outcome cannot duplicate records; it only changes the advice in
// the error message.
async function submit(
  operation: string,
  attempted: readonly StrongRef[],
  send: () => Promise<readonly unknown[] | undefined>,
  retrySafe: boolean,
): Promise<void> {
  let results: readonly unknown[] | undefined;
  try {
    results = await send();
  } catch (error) {
    throw classifyFailure(operation, error, attempted, retrySafe);
  }
  assertReportedRefs(operation, attempted, results);
}

function classifyFailure(
  operation: string,
  error: unknown,
  attempted: readonly StrongRef[],
  retrySafe: boolean,
) {
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
      retryAdvice(operation, retrySafe, attempted.length !== 1),
    attempted,
    { cause: error },
  );
}

function retryAdvice(operation: string, retrySafe: boolean, plural: boolean): string {
  if (retrySafe) {
    const subject = plural
      ? "every record has a fixed key and none is created if it exists, so the call either creates them or fails because one already exists"
      : "the record has a fixed key and is only created if absent, so the call either creates it or fails because it already exists";
    return `The SDK does not retry, but calling ${operation} again is safe: ${subject}, most likely from the first attempt. To check first, use com.atproto.repo.getRecord.`;
  }
  return `Check whether they exist (for example with com.atproto.repo.getRecord) before trying again. The SDK does not retry, because calling ${operation} again would create duplicates with new record keys if the first attempt succeeded.`;
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
