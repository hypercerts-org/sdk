import * as likeRecord from "@hypercerts-org/lexicon/app/certified/feed/like";
import * as repostRecord from "@hypercerts-org/lexicon/app/certified/feed/repost";
import { recordRefAction } from "./action.js";
import { createAction, undoAction } from "./run-action.js";

const likeAction = recordRefAction({ create: "like", undo: "unlike" }, likeRecord.main);
const repostAction = recordRefAction({ create: "repost", undo: "unrepost" }, repostRecord.main);

/**
 * Likes a record: creates an `app.certified.feed.like` record in the authenticated account's repo.
 *
 * @remarks
 * A like is social feedback and nothing more. It carries no protocol meaning about its target: it is
 * not an evaluation, an acknowledgement or proof of endorsement, and applications should not read
 * it as one.
 *
 * The SDK reads the target from the PDS that hosts it (public records of other accounts resolve
 * too) and pins the version it finds: the like stores the target's URI and its CID at that moment,
 * so a later edit of the target does not change which version was liked. If the target cannot be
 * read, nothing is written. The target is never modified or created. The record key is a new TID
 * chosen by the SDK, and `createdAt` defaults to the time of the call.
 *
 * Nothing is deduplicated: calling this again for the same record creates a second like, and a later
 * {@link unlike} then does nothing until the duplicate is removed (see {@link UndoResult}).
 *
 * `via` is optional: the URI of the record through which the target was encountered, typically a
 * repost. The SDK reads it the same way. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The record to like and optional `createdAt` and `via`. See
 * {@link RecordActionInput}.
 * @returns The new like's URI and CID (not the target's).
 * @throws {@link TypeError} If `input` has an unknown field, a `targetUri` that is not a full record
 * URI (a bare DID, a handle authority or a partial URI), a `via` that is not a record URI, or a
 * `createdAt` the lexicon rejects. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the target or the `via` record cannot
 * be read (missing, or the PDS cannot be reached). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the like
 * may or may not exist. It carries the URI to check. The SDK does not retry, because a retry would
 * create a second like with a new key if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { like } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const liked = await like(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * console.log(liked.uri); // at://<your DID>/app.certified.feed.like/<tid>
 * ```
 *
 * @example Liking something found through a repost
 * ```ts
 * import { like } from "@hypercerts-org/sdk/social";
 *
 * await like(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 *   via: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9", // read and pinned for you
 * });
 * ```
 */
export const like = createAction(likeAction);

/**
 * Removes a like: deletes the authenticated account's one `app.certified.feed.like` record for
 * `targetUri`.
 *
 * @remarks
 * The SDK lists the account's own likes (all pages, from its own PDS; no indexer) and matches them
 * by the URI of the record they like, whatever CID they pin, so a like of an earlier version of an
 * edited target is found too. With no match it returns `not-found`. With exactly one it deletes that
 * record, only if it still has the CID the scan saw, and returns `deleted`. With several it deletes
 * nothing and returns `ambiguous` with the number of matches: the record was liked more than once,
 * and the SDK does not choose which like to remove. See {@link UndoResult}.
 *
 * The target is not read, so it does not have to exist any more. The scan is a snapshot: it cannot
 * stop another writer creating a like of the same record while it runs or after it, so `deleted`
 * does not promise that no like of `targetUri` remains.
 *
 * The session needs permission to delete `app.certified.feed.like` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's repository is scanned.
 * @param input - The record to unlike. See {@link RecordTargetInput}.
 * @returns `deleted`, `not-found` or `ambiguous` with `matchCount`. See {@link UndoResult}.
 * @throws {@link TypeError} If `input` has an unknown field or a `targetUri` that is not a full
 * record URI. Nothing was changed.
 * @throws {@link Error} If the client is not authenticated, or the likes cannot be read in full (a
 * failed or malformed page). A partial read is never treated as "not found". Nothing was changed.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the like changed after the scan, so it was not deleted; nothing is retried or
 * deleted without that check, and calling again scans afresh.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the like
 * may or may not be deleted. It carries the like's URI and CID. The SDK does not retry; calling
 * again is safe and either deletes the like or returns `not-found`.
 *
 * @example
 * ```ts
 * import { unlike } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const result = await unlike(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * if (result.status === "ambiguous") {
 *   // Liked more than once, so nothing was deleted: remove the extra likes yourself.
 * }
 * ```
 */
export const unlike = undoAction(likeAction);

/**
 * Reposts a record: creates an `app.certified.feed.repost` record in the authenticated account's
 * repo, surfacing the target to the account's followers.
 *
 * @remarks
 * The SDK reads the target from the PDS that hosts it (public records of other accounts resolve
 * too) and pins the version it finds: the repost stores the target's URI and its CID at that
 * moment, so a later edit of the target does not change which version was reposted. If the target
 * cannot be read, nothing is written. The target is never modified or created. The record key is a
 * new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 *
 * Nothing is deduplicated: calling this again for the same record creates a second repost, and a
 * later {@link unrepost} then does nothing until the duplicate is removed (see {@link UndoResult}).
 *
 * `via` is optional: the URI of the record through which the target was encountered, typically
 * another repost. The SDK reads it the same way. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The record to repost and optional `createdAt` and `via`. See
 * {@link RecordActionInput}.
 * @returns The new repost's URI and CID (not the target's).
 * @throws {@link TypeError} If `input` has an unknown field, a `targetUri` that is not a full record
 * URI (a bare DID, a handle authority or a partial URI), a `via` that is not a record URI, or a
 * `createdAt` the lexicon rejects. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the target or the `via` record cannot
 * be read (missing, or the PDS cannot be reached). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * repost may or may not exist. It carries the URI to check. The SDK does not retry, because a retry
 * would create a second repost with a new key if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { repost } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const reposted = await repost(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * console.log(reposted.uri); // at://<your DID>/app.certified.feed.repost/<tid>
 * ```
 *
 * @example Reposting something found through another repost
 * ```ts
 * import { repost } from "@hypercerts-org/sdk/social";
 *
 * await repost(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 *   via: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9", // read and pinned for you
 * });
 * ```
 */
export const repost = createAction(repostAction);

/**
 * Removes a repost: deletes the authenticated account's one `app.certified.feed.repost` record for
 * `targetUri`.
 *
 * @remarks
 * The SDK lists the account's own reposts (all pages, from its own PDS; no indexer) and matches
 * them by the URI of the record they repost, whatever CID they pin, so a repost of an earlier
 * version of an edited target is found too. With no match it returns `not-found`. With exactly one
 * it deletes that record, only if it still has the CID the scan saw, and returns `deleted`. With
 * several it deletes nothing and returns `ambiguous` with the number of matches: the record was
 * reposted more than once, and the SDK does not choose which repost to remove. See
 * {@link UndoResult}.
 *
 * The target is not read, so it does not have to exist any more. The scan is a snapshot: it cannot
 * stop another writer creating a repost of the same record while it runs or after it, so `deleted`
 * does not promise that no repost of `targetUri` remains.
 *
 * The session needs permission to delete `app.certified.feed.repost` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's repository is scanned.
 * @param input - The record to unrepost. See {@link RecordTargetInput}.
 * @returns `deleted`, `not-found` or `ambiguous` with `matchCount`. See {@link UndoResult}.
 * @throws {@link TypeError} If `input` has an unknown field or a `targetUri` that is not a full
 * record URI. Nothing was changed.
 * @throws {@link Error} If the client is not authenticated, or the reposts cannot be read in full (a
 * failed or malformed page). A partial read is never treated as "not found". Nothing was changed.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the repost changed after the scan, so it was not deleted; nothing is retried or
 * deleted without that check, and calling again scans afresh.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the repost
 * may or may not be deleted. It carries the repost's URI and CID. The SDK does not retry; calling
 * again is safe and either deletes the repost or returns `not-found`.
 *
 * @example
 * ```ts
 * import { unrepost } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const result = await unrepost(context, {
 *   targetUri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8",
 * });
 * if (result.status === "ambiguous") {
 *   // Reposted more than once, so nothing was deleted: remove the extra reposts yourself.
 * }
 * ```
 */
export const unrepost = undoAction(repostAction);
