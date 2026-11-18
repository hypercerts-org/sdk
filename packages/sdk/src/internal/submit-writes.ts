import type { CidString } from "@atproto/lex";
import type { BuildContext } from "./build-context.js";
import type { PreparedRecord } from "./prepare-record.js";
import type { DeleteTarget } from "./write-target.js";

/** What a request writes besides the records it creates. */
interface SubmitOptions {
  /**
   * Existing records to replace with a new full value, written after the creates in the same
   * commit. Each is prepared with the record key it already has (see `prepareRecord`).
   */
  readonly updates?: readonly PreparedRecord[];
  /**
   * The CID of the repo's head commit as the caller read it (see `WriteTarget.readHead`). The PDS rejects
   * the whole request with `InvalidSwap` if the repo has a newer commit by then. Set it when an
   * update is based on a record the caller read, because `applyWrites` has no per-record check.
   */
  readonly swapCommit?: CidString;
  /**
   * Whether calling again after an unknown outcome cannot duplicate records: either every record has
   * a key the input decided and the caller checks none exists before sending, or the caller reads a
   * record with a fixed key before every attempt, which a first attempt that succeeded would have
   * created, and gives `retrySafeReason`. Only changes the advice in the error message.
   */
  readonly retrySafe?: boolean;
  /**
   * With `retrySafe`, why calling again is safe when that is not "every record has a fixed key". It
   * completes the sentence "calling <operation> again is safe: ...", so it must read as a clause
   * without a final period. Absent: the message says every record has a fixed key.
   */
  readonly retrySafeReason?: string;
}

/**
 * The most writes one `applyWrites` request may hold. The reference PDS (`@atproto/pds`, checked in
 * 0.5.34 and 0.5.44) rejects a request with more with HTTP 400 "Too many writes. Max: 200"; the
 * lexicon states no limit.
 */
const MAX_WRITES_PER_REQUEST = 200;

/**
 * Fails before anything is uploaded or written when a call would write more records than one
 * `applyWrites` request may hold.
 *
 * The SDK never splits a call into several requests: the records reference each other
 * and are committed together or not at all, which several requests could not guarantee.
 *
 * Throws TypeError, so the caller learns to shrink the input and that nothing was written.
 */
export function assertWithinWriteLimit(operation: string, count: number): void {
  if (count <= MAX_WRITES_PER_REQUEST) return;
  throw new TypeError(
    `${operation}: this call would write ${count} records, but one write holds at most ${MAX_WRITES_PER_REQUEST}. Nothing was written. Create some records first and pass them as { uri }.`,
  );
}

/**
 * Creates all `records` in `did`'s repo, and replaces the records in `options.updates`, with one
 * `com.atproto.repo.applyWrites` request, which the PDS applies as a single commit: every write
 * happens or none does.
 *
 * Boundaries:
 * - Never retries and never splits the request; the caller decides what to do about a failure.
 *   `options.retrySafe` says whether calling again after an unknown outcome cannot duplicate records
 *   (see `SubmitOptions.retrySafe`, and `retrySafeReason` for the wording); it only changes the
 *   advice in the error message.
 * - Does not pass `validate`, so the PDS applies its own default; records are validated by the
 *   builders against their lexicons before they get here.
 * - Classifies a failure as definite only when the PDS answered with an HTTP 4xx other than 408.
 *   Everything else, including a 2xx whose body the client could not read, is outcome-unknown.
 * - Compares the PDS's reported URIs and CIDs with the computed ones, because records already
 *   reference each other by CID.
 * - `options.swapCommit` is the only guard against a concurrent change that `applyWrites` offers.
 *   It covers the whole repo, so any other write to the account since the head was read, not only
 *   one to the updated record, rejects the request: a false alarm the caller accepts.
 *
 * Throws WriteRejectedError, WriteOutcomeUnknownError or WriteResultMismatchError. `build.operation`
 * names the public function for the message.
 */
export function submitWrites(
  build: BuildContext,
  records: readonly PreparedRecord[],
  options: SubmitOptions = {},
): Promise<void> {
  return build.target.submit({
    creates: records,
    updates: options.updates ?? [],
    createOnly: false,
    swapCommit: options.swapCommit,
    retrySafe: options.retrySafe,
    retrySafeReason: options.retrySafeReason,
  });
}

/**
 * Creates one record at a record key that its lexicon fixes or its data decides, only if there is
 * no record at that key yet, with `com.atproto.repo.putRecord` and `swapRecord: null`.
 *
 * Used for records whose key can already be taken (see `fixedRecordKey`, and a kind's
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
export function submitCreateOnly(build: BuildContext, record: PreparedRecord): Promise<void> {
  return build.target.submit({ creates: [record], updates: [], createOnly: true });
}

/**
 * Deletes one record from `did`'s repo with `com.atproto.repo.deleteRecord`, with
 * `swapRecord: target.cid` when the caller gave the CID.
 *
 * Boundaries:
 * - Never retries. With a CID it never deletes a record that has another version: the PDS refuses
 *   and nothing is deleted. Without one the delete is unconditional.
 * - Classifies a failure as the other write functions do: definite only when the PDS answered with
 *   an HTTP 4xx other than 408 (and then nothing was deleted), outcome-unknown otherwise.
 * - Has no reported result to compare: `deleteRecord` answers with a commit, not with references.
 *   The reference PDS (`@atproto/pds`) treats a record that is already missing as nothing to do and
 *   answers success whatever `swapRecord` says, so that answer is indistinguishable from this call
 *   having deleted it, and calling again after any outcome is safe.
 * - `attempted` of the errors is `[{ uri, cid }]` with a CID, and empty without one: a reference to
 *   a record needs a CID, and none is known.
 *
 * Throws WriteRejectedError (with `code` `InvalidSwap` when the record no longer has `target.cid`,
 * so it was not deleted) or WriteOutcomeUnknownError. Throws TypeError when `target.uri` is not a
 * record URI.
 */
export function submitDelete(build: BuildContext, target: DeleteTarget): Promise<void> {
  return build.target.delete(target);
}
