import { asAtUriString } from "@atproto/lex";
import * as defs from "@hypercerts-org/lexicon/app/certified/defs";
import * as entityFollow from "@hypercerts-org/lexicon/app/certified/graph/entityFollow";
import * as follow from "@hypercerts-org/lexicon/app/certified/graph/follow";
import {
  accountTarget,
  type FollowAccountInput,
  type RecordActionInput,
  type RecordTargetInput,
  recordTarget,
  type SocialAction,
  type UnfollowAccountInput,
  uriOf,
} from "./action.js";
import { createAction, undoAction } from "./run-action.js";

const followAccountAction: SocialAction<FollowAccountInput, UnfollowAccountInput> = {
  names: { create: "followAccount", undo: "unfollowAccount" },
  schema: follow.main,
  ...accountTarget,
  subject: (_context, { targetDid }) => targetDid,
  isSubject: (stored, { targetDid }) => stored === targetDid,
};

const followEntityAction: SocialAction<RecordActionInput, RecordTargetInput> = {
  names: { create: "followEntity", undo: "unfollowEntity" },
  schema: entityFollow.main,
  ...recordTarget,
  // The URI only: no CID, so the follow keeps pointing at the record when it is updated.
  subject: (_context, { targetUri }) => defs.recordSubject.build({ uri: asAtUriString(targetUri) }),
  isSubject: (stored, { targetUri }) =>
    typeof stored === "object" &&
    stored !== null &&
    "$type" in stored &&
    stored.$type === defs.recordSubject.$type &&
    uriOf(stored) === targetUri,
};

/**
 * Follows an account: creates an `app.certified.graph.follow` record in the authenticated
 * account's repo.
 *
 * @remarks
 * `targetDid` is the account being followed. Nothing about it is looked up: the SDK does not check
 * that the account exists or has a Certified profile. The record key is a new TID chosen by the
 * SDK, and `createdAt` defaults to the time of the call.
 *
 * Nothing is deduplicated: calling this again for an account that is already followed creates a
 * second follow record, and a later {@link unfollowAccount} then does nothing until the duplicate is
 * removed (see {@link UndoResult}).
 *
 * `via` is optional: the URI of a record through which the account was found (a starter pack, for
 * example). The SDK reads it to pin its current version. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The account to follow and optional `createdAt` and `via`. See
 * {@link FollowAccountInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, a `targetDid` that is not a DID (a
 * handle, for example), a `via` that is not a record URI, or a `createdAt` the lexicon rejects.
 * Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the `via` record cannot be read.
 * Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx), for example because
 * the session may not create `app.certified.graph.follow` records. Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * record may or may not exist. It carries the URI to check. The SDK does not retry, because a retry
 * would create a second follow with a new key if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { followAccount } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const follow = await followAccount(context, { targetDid: "did:plc:abc123" });
 * console.log(follow.uri); // at://<your DID>/app.certified.graph.follow/<tid>
 * ```
 *
 * @example A handle is not an account identifier here
 * ```ts
 * import { followAccount } from "@hypercerts-org/sdk/social";
 *
 * // Does not compile: `targetDid` is a `DidString`. A JavaScript caller, or a cast, gets a
 * // TypeError at runtime. Resolve the handle to a DID yourself first.
 * await followAccount(context, { targetDid: "alice.bsky.social" });
 * ```
 *
 * @example A DID that arrives as a plain string
 * ```ts
 * import { isDidString } from "@atproto/lex";
 * import { followAccount } from "@hypercerts-org/sdk/social";
 *
 * // `did` is a string, for example from a form field. `isDidString` checks it and narrows the type.
 * if (!isDidString(did)) throw new Error(`${did} is not a DID`);
 * await followAccount(context, { targetDid: did });
 * ```
 */
export const followAccount = createAction(followAccountAction);

/**
 * Stops following an account: deletes the authenticated account's one
 * `app.certified.graph.follow` record for `targetDid`.
 *
 * @remarks
 * The SDK lists the account's own follow records (all pages, from its own PDS; no indexer), and
 * matches them by the DID they follow. With no match it returns `not-found`. With exactly one it
 * deletes that record, only if it still has the CID the scan saw, and returns `deleted`. With
 * several it deletes nothing and returns `ambiguous` with the number of matches: the account
 * followed the same DID more than once, and the SDK does not choose which record to remove. See
 * {@link UndoResult}.
 *
 * The scan is a snapshot. It cannot stop another writer creating a follow of the same account while
 * it runs or after it, so a result of `deleted` does not promise that no follow of `targetDid`
 * remains. The account being followed does not have to exist any more.
 *
 * The session needs permission to delete `app.certified.graph.follow` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's repository is scanned.
 * @param input - The account to stop following. See {@link UnfollowAccountInput}.
 * @returns `deleted`, `not-found` or `ambiguous` with `matchCount`. See {@link UndoResult}.
 * @throws {@link TypeError} If `input` has an unknown field or a `targetDid` that is not a DID.
 * Nothing was changed.
 * @throws {@link Error} If the client is not authenticated, or the follow records cannot be read in
 * full (a failed or malformed page). A partial read is never treated as "not found". Nothing was
 * changed.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the record changed after the scan, so it was not deleted; nothing is retried or
 * deleted without that check, and calling again scans afresh.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not be deleted. It carries the record's URI and CID. The SDK does not retry; calling
 * again is safe and either deletes the record or returns `not-found`.
 *
 * @example
 * ```ts
 * import { unfollowAccount } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const result = await unfollowAccount(context, { targetDid: "did:plc:abc123" });
 * if (result.status === "ambiguous") {
 *   // Followed more than once, so nothing was deleted: remove the extra follow records yourself.
 *   console.log(`${result.matchCount} follow records for this account`);
 * }
 * ```
 */
export const unfollowAccount = undoAction(followAccountAction);

/**
 * Follows a record's identity: creates an `app.certified.graph.entityFollow` record in the
 * authenticated account's repo.
 *
 * @remarks
 * The follow stores the target's URI as a `app.certified.defs#recordSubject` and no CID, so it
 * keeps pointing at the record through later updates. The target is not read: the SDK does not
 * check that it exists, so a follow of a record that is missing, private or of an unknown Lexicon
 * is created all the same. (A like or a repost differs: see {@link like}, which pins the version it
 * read.) The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the
 * call.
 *
 * Nothing is deduplicated: calling this again for the same record creates a second follow, and a
 * later {@link unfollowEntity} then does nothing until the duplicate is removed (see
 * {@link UndoResult}).
 *
 * `via` is optional: the URI of a record through which the target was found. The SDK reads it to
 * pin its current version. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The record to follow and optional `createdAt` and `via`. See
 * {@link RecordActionInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, a `targetUri` that is not a full record
 * URI (a bare DID, a handle authority or a partial URI), a `via` that is not a record URI, or a
 * `createdAt` the lexicon rejects. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the `via` record cannot be read.
 * Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * record may or may not exist. It carries the URI to check. The SDK does not retry, because a retry
 * would create a second follow with a new key if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { followEntity } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const follow = await followEntity(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * ```
 *
 * @example An account is not a record
 * ```ts
 * import { followAccount, followEntity } from "@hypercerts-org/sdk/social";
 *
 * await followEntity(context, { targetUri: "did:plc:abc123" }); // TypeError
 * await followAccount(context, { targetDid: "did:plc:abc123" }); // follow an account like this
 * ```
 */
export const followEntity = createAction(followEntityAction);

/**
 * Stops following a record: deletes the authenticated account's one
 * `app.certified.graph.entityFollow` record for `targetUri`.
 *
 * @remarks
 * The SDK lists the account's own entity follows (all pages, from its own PDS; no indexer), and
 * matches them by the record URI they follow. With no match it returns `not-found`. With exactly one
 * it deletes that record, only if it still has the CID the scan saw, and returns `deleted`. With
 * several it deletes nothing and returns `ambiguous` with the number of matches: the record was
 * followed more than once, and the SDK does not choose which follow to remove. See
 * {@link UndoResult}.
 *
 * The target is not read, so it does not have to exist any more. The scan is a snapshot: it cannot
 * stop another writer creating a follow of the same record while it runs or after it, so `deleted`
 * does not promise that no follow of `targetUri` remains.
 *
 * The session needs permission to delete `app.certified.graph.entityFollow` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's repository is scanned.
 * @param input - The record to stop following. See {@link RecordTargetInput}.
 * @returns `deleted`, `not-found` or `ambiguous` with `matchCount`. See {@link UndoResult}.
 * @throws {@link TypeError} If `input` has an unknown field or a `targetUri` that is not a full
 * record URI. Nothing was changed.
 * @throws {@link Error} If the client is not authenticated, or the entity follows cannot be read in
 * full (a failed or malformed page). A partial read is never treated as "not found". Nothing was
 * changed.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the record changed after the scan, so it was not deleted; nothing is retried or
 * deleted without that check, and calling again scans afresh.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not be deleted. It carries the record's URI and CID. The SDK does not retry; calling
 * again is safe and either deletes the record or returns `not-found`.
 *
 * @example
 * ```ts
 * import { unfollowEntity } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const result = await unfollowEntity(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * console.log(result.status); // "deleted", "not-found" or "ambiguous"
 * ```
 */
export const unfollowEntity = undoAction(followEntityAction);
