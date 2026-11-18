import type { StrongRef } from "./internal/resolve-record-ref.js";

/**
 * Base class of the errors thrown when the single request that writes records did not succeed.
 * Check `instanceof` against {@link WriteRejectedError}, {@link WriteOutcomeUnknownError} and
 * {@link WriteResultMismatchError} to tell them apart.
 */
export abstract class WriteError extends Error {
  /**
   * The URI and CID of every record the failed request tried to write, in request order: the new
   * records first, then any record it updated (with the CID the update would give it). For a delete,
   * the record with the CID it was guarded with; a delete without a CID guard lists nothing, because
   * a reference needs a CID.
   */
  readonly attempted: readonly StrongRef[];

  constructor(message: string, attempted: readonly StrongRef[], options?: ErrorOptions) {
    super(message, options);
    this.attempted = attempted;
  }
}

/**
 * The PDS answered with a client error (HTTP 4xx) and so did not apply any of the writes: no
 * record was created and none was changed. The request can be corrected and sent again; nothing
 * needs cleaning up, except any blobs uploaded before the write (see {@link uploadBlob}).
 *
 * `status` and `code` are the HTTP status and the XRPC error code (for example `InvalidRequest`).
 * `cause` is the client's original error.
 *
 * @remarks
 * Concurrent changes (`InvalidSwap`): `applyWrites` cannot say "only if this record is absent" or
 * "only if it is unchanged". An operation that decides something from what it read (whether a
 * record exists, what a record holds) therefore reads the repository's latest commit first, then
 * those records, and asks the PDS to apply the write only if the repository is still at that
 * commit (`swapCommit`). If anything else wrote to the account in between, the PDS rejects the
 * whole request with `code` `"InvalidSwap"` and nothing is written. The check is coarse: an
 * unrelated write to the same account (a post, a like, another call) causes it too, so an account
 * that writes often will see it now and then. Nothing is wrong with the input. The SDK does not
 * retry or merge; call again, which reads everything afresh. {@link RecordAlreadyExistsError} has
 * the same `code`, but calling again cannot fix a taken key: rule it out first.
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
 * so it is not known whether the PDS applied the writes. `attempted` lists the URI and CID of every
 * record that may now exist or have changed; check them (for example with
 * `com.atproto.repo.getRecord`) before deciding what to do. The one exception is an undo function
 * (`unlike`, `unrepost`, `unfollowAccount`, `unfollowEntity`) called without `cid`: its
 * `attempted` is empty, because a reference needs a CID, and the message names the record's URI.
 * Calling an undo function again is safe.
 *
 * The SDK does not retry. Retrying with new record keys would duplicate every record if the first
 * attempt had succeeded. The exception is a record whose key is fixed or decided by its data and
 * that is only created if absent (`createProfile`, and `createVocabularyTag`, whose nested tags are
 * checked before the write): calling again either creates it or is refused because it already
 * exists, most likely from the first attempt, so it cannot duplicate. `createOrganization` is
 * another: it reads its organization, which has a fixed key, before every attempt, so calling again
 * either creates everything or is refused because the organization already exists.
 */
export class WriteOutcomeUnknownError extends WriteError {
  override readonly name = "WriteOutcomeUnknownError";
}

/**
 * The PDS applied the writes but reported different URIs or CIDs than the SDK computed. Records
 * that were written with references to each other (an Activity and its rights, for example) may
 * therefore point at CIDs that do not match what is stored. `attempted` holds the references the
 * SDK computed and `reported` the ones the PDS returned, both in request order. Compare them and
 * inspect what was stored before calling again.
 */
export class WriteResultMismatchError extends WriteError {
  override readonly name = "WriteResultMismatchError";
  readonly reported: readonly StrongRef[];

  constructor(message: string, attempted: readonly StrongRef[], reported: readonly StrongRef[]) {
    super(message, attempted);
    this.reported = reported;
  }
}
