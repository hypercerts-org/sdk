import { asAtUriString } from "@atproto/lex";
import * as defs from "@hypercerts-org/lexicon/app/certified/defs";
import * as entityFollow from "@hypercerts-org/lexicon/app/certified/graph/entityFollow";
import * as follow from "@hypercerts-org/lexicon/app/certified/graph/follow";
import {
  accountCreateInput,
  type FollowAccountInput,
  followUndoInput,
  type RecordActionInput,
  recordCreateInput,
  type SocialAction,
  type UnfollowAccountInput,
  type UnfollowEntityInput,
} from "./action.js";
import { createAction, undoAction } from "./run-action.js";

const followAccountAction: SocialAction<FollowAccountInput, UnfollowAccountInput> = {
  names: { create: "followAccount", undo: "unfollowAccount" },
  schema: follow.main,
  createInput: accountCreateInput,
  subject: (_context, { targetDid }) => targetDid,
  undoInput: followUndoInput,
  undoUri: ({ followUri }) => followUri,
};

const followEntityAction: SocialAction<RecordActionInput, UnfollowEntityInput> = {
  names: { create: "followEntity", undo: "unfollowEntity" },
  schema: entityFollow.main,
  createInput: recordCreateInput,
  // The URI only: no CID, so the follow keeps pointing at the record when it is updated.
  subject: (_context, { targetUri }) => defs.recordSubject.build({ uri: asAtUriString(targetUri) }),
  undoInput: followUndoInput,
  undoUri: ({ followUri }) => followUri,
};

/**
 * Follows an account: creates an `app.certified.graph.follow` record in the authenticated
 * account's repo.
 *
 * @remarks
 * `targetDid` is the account being followed, a plain DID stored as given. It is never looked up:
 * ATProto lets a DID dangle, so the SDK does not check that the account exists or has a Certified
 * profile. The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of
 * the call.
 *
 * Nothing is deduplicated: calling this again for an account that is already followed creates a
 * second follow record. {@link unfollowAccount} deletes only the record whose URI it is given, so
 * each duplicate has to be undone with its own URI.
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
 * the session may not create `app.certified.graph.follow` records.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second follow if the first attempt had succeeded.
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
 * Stops following an account: deletes the `app.certified.graph.follow` record at `followUri` from
 * the authenticated account's repo.
 *
 * @remarks
 * Deletes exactly the record whose URI you give. The SDK does not scan the repository, ask an
 * indexer or read the followed account, so it does not look for other follow records of the same
 * account: after a duplicate follow (see {@link followAccount}), the other record stays until you
 * delete it with its own URI.
 *
 * Where the URI comes from: the `uri` that {@link followAccount} returned (keep it), or the
 * Hypercerts API, for example `app.certified.graph.getFollow`, which returns the follow record's
 * `uri` and `cid`. It is the URI of the follow record, not the DID of the followed account.
 *
 * The PDS treats deleting a record that does not exist as nothing to do and answers success, so a
 * stale URI is harmless and the call is safe to repeat. The call does not say whether it removed
 * anything.
 *
 * `cid` is optional. With it, the PDS deletes the record only if it still has that CID; without
 * it, the record is deleted whatever its version.
 *
 * The session needs permission to delete `app.certified.graph.follow` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's own records can be deleted.
 * @param input - The follow record's URI and an optional `cid`. See {@link UnfollowAccountInput}.
 * @returns Nothing. It resolves when the PDS confirmed the deletion or that the record is absent.
 * @throws {@link TypeError} If `input` has an unknown field, a `followUri` that is not a full record
 * URI, one whose collection is not `app.certified.graph.follow` or that is in another account's
 * repository, or a `cid` that is not a CID string. Nothing was sent.
 * @throws {@link Error} If the client is not authenticated. Nothing was sent.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the record no longer has the given `cid`, so it was not deleted.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is safe.
 *
 * @example
 * ```ts
 * import { followAccount, unfollowAccount } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const follow = await followAccount(context, { targetDid: "did:plc:abc123" });
 * // Keep `follow.uri` (and `follow.cid`) to undo it later.
 * await unfollowAccount(context, { followUri: follow.uri, cid: follow.cid });
 * ```
 *
 * @example The follow record's URI, not the followed account
 * ```ts
 * import { unfollowAccount } from "@hypercerts-org/sdk/social";
 *
 * // TypeError: `followUri` is the URI of the follow record, not the DID of the followed account.
 * await unfollowAccount(context, { followUri: "did:plc:abc123" });
 * ```
 */
export const unfollowAccount = undoAction(followAccountAction);

/**
 * Follows a record's identity: creates an `app.certified.graph.entityFollow` record in the
 * authenticated account's repo.
 *
 * @remarks
 * The follow stores the target's URI as a `app.certified.defs#recordSubject` and no CID, so it
 * keeps pointing at the record through later updates. With no CID to pin, the target is a plain URI
 * stored as given and never read: ATProto lets a URI dangle, so the SDK does not check that the
 * record exists, and a follow of a record that is missing, private or of an unknown Lexicon is
 * created all the same. (A like or a repost differs: see {@link like}, which stores a CID and so
 * pins the version it read.) The record key is a new TID chosen by the SDK, and `createdAt`
 * defaults to the time of the call.
 *
 * Nothing is deduplicated: calling this again for the same record creates a second follow.
 * {@link unfollowEntity} deletes only the record whose URI it is given, so each duplicate has to be
 * undone with its own URI.
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
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second follow if the first attempt had succeeded.
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
 * Stops following a record: deletes the `app.certified.graph.entityFollow` record at `followUri`
 * from the authenticated account's repo.
 *
 * @remarks
 * Deletes exactly the record whose URI you give. The SDK does not scan the repository, ask an
 * indexer or read the followed record, so it does not look for other follow records of the same
 * target: after a duplicate follow (see {@link followEntity}), the other record stays until you
 * delete it with its own URI. The followed record does not have to exist any more.
 *
 * Where the URI comes from: the `uri` that {@link followEntity} returned (keep it), or the
 * Hypercerts API, for example `app.certified.graph.getEntityFollow`, which returns the follow
 * record's `uri` and `cid`. It is the URI of the follow record, not the URI of the record that is
 * followed.
 *
 * The PDS treats deleting a record that does not exist as nothing to do and answers success, so a
 * stale URI is harmless and the call is safe to repeat. The call does not say whether it removed
 * anything.
 *
 * `cid` is optional. With it, the PDS deletes the record only if it still has that CID; without
 * it, the record is deleted whatever its version.
 *
 * The session needs permission to delete `app.certified.graph.entityFollow` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's own records can be deleted.
 * @param input - The follow record's URI and an optional `cid`. See {@link UnfollowEntityInput}.
 * @returns Nothing. It resolves when the PDS confirmed the deletion or that the record is absent.
 * @throws {@link TypeError} If `input` has an unknown field, a `followUri` that is not a full record
 * URI, one whose collection is not `app.certified.graph.entityFollow` or that is in another
 * account's repository, or a `cid` that is not a CID string. Nothing was sent.
 * @throws {@link Error} If the client is not authenticated. Nothing was sent.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the record no longer has the given `cid`, so it was not deleted.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is safe.
 *
 * @example
 * ```ts
 * import { followEntity, unfollowEntity } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const follow = await followEntity(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * // Keep `follow.uri` (and `follow.cid`) to undo it later.
 * await unfollowEntity(context, { followUri: follow.uri, cid: follow.cid });
 * ```
 *
 * @example The follow record's URI, not the followed record's
 * ```ts
 * import { unfollowEntity } from "@hypercerts-org/sdk/social";
 *
 * // TypeError: this is the followed activity, not an app.certified.graph.entityFollow record.
 * await unfollowEntity(context, {
 *   followUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * ```
 */
export const unfollowEntity = undoAction(followEntityAction);
