import type { CidString } from "@atproto/lex";
import type { BuildContext } from "./build-context.js";
import type { PreparedRecord } from "./prepare-record.js";
import type { DeleteTarget, PlannedUpdate } from "./write-target.js";

/** What a request writes besides the records it creates. */
interface SubmitOptions {
  /**
   * Existing records to replace with a new full value, written after the creates in the same
   * commit. Each is prepared with the record key it already has (see `prepareRecord`).
   */
  readonly updates?: readonly PlannedUpdate[];
  /**
   * The CID of the repo's head commit as the caller read it (see `WriteTarget.readHead`). The PDS rejects
   * the whole request with `InvalidSwap` if the repo has a newer commit by then. Set it when an
   * update is based on a record the caller read and the request also creates records, because
   * `applyWrites` has no per-record check. For a request that is one update, give that update's
   * `swapRecord` instead.
   */
  readonly swapCommit?: CidString | undefined;
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
  /**
   * With `retrySafe`: the repeat is safe only because the write is one atomic commit (the plan has
   * records with generated keys). A target that is not atomic then gives no safe-repeat advice.
   */
  readonly retrySafeOnlyAtomically?: boolean;
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
 * Creates all `records` in the target's repo, and replaces the records in `options.updates`, as one
 * `WritePlan` (the PDS target applies it as a single commit: every write happens or none does).
 * For the boundaries, see `pdsTarget`.
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
    retrySafeOnlyAtomically: options.retrySafeOnlyAtomically,
  });
}

/**
 * Creates one record at a record key that its lexicon fixes or its data decides, only if there is
 * no record at that key yet (see `fixedRecordKey`, and a kind's `recordKey`). Unlike
 * `submitWrites`, calling again after an unknown outcome is safe. For the boundaries, see
 * `pdsTarget`.
 *
 * Throws RecordAlreadyExistsError when the key is taken, and otherwise WriteRejectedError,
 * WriteOutcomeUnknownError or WriteResultMismatchError.
 */
export function submitCreateOnly(build: BuildContext, record: PreparedRecord): Promise<void> {
  return build.target.submit({ creates: [record], updates: [], createOnly: true });
}

/**
 * Deletes one record from the target's repo, only if it still has `target.cid` when the caller gave
 * the CID. For the boundaries, see `pdsTarget`.
 *
 * Throws WriteRejectedError (with `code` `InvalidSwap` when the record no longer has `target.cid`,
 * so it was not deleted) or WriteOutcomeUnknownError. Throws TypeError when `target.uri` is not a
 * record URI.
 */
export function submitDelete(build: BuildContext, target: DeleteTarget): Promise<void> {
  return build.target.delete(target);
}
