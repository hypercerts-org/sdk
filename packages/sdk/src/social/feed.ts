import * as likeRecord from "@hypercerts-org/lexicon/app/certified/feed/like";
import * as repostRecord from "@hypercerts-org/lexicon/app/certified/feed/repost";
import { recordRefAction } from "./action.js";
import { createAction, undoAction } from "./run-action.js";

const likeAction = recordRefAction({ create: "like", undo: "unlike" }, likeRecord.main, "like");
const repostAction = recordRefAction(
  { create: "repost", undo: "unrepost" },
  repostRecord.main,
  "repost",
);

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
 * Nothing is deduplicated: calling this again for the same record creates a second like.
 * {@link unlike} deletes only the record whose URI it is given, so each duplicate has to be undone
 * with its own URI.
 *
 * `via` is optional: `{ uri }` of the record through which the target was encountered, typically a
 * repost. The SDK reads it the same way. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The record to like and optional `createdAt` and `via`. See
 * {@link RecordActionInput}.
 * @returns The new like's URI and CID (not the target's).
 * @throws {@link TypeError} If `input` has an unknown field, a `target.uri` that is not a full record
 * URI (a bare DID, a handle authority or a partial URI), a `via.uri` that is not a record URI, or a
 * `createdAt` the lexicon rejects. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the target or the `via` record cannot
 * be read (missing, or the PDS cannot be reached). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second like if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { like } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const liked = await like(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * console.log(liked.uri); // at://<your DID>/app.certified.feed.like/<tid>
 * ```
 *
 * @example Liking something found through a repost
 * ```ts
 * import { like } from "@hypercerts-org/sdk/social";
 *
 * await like(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *   via: { uri: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9" }, // read and pinned for you
 * });
 * ```
 */
export const like = createAction(likeAction);

/**
 * Removes a like: deletes the `app.certified.feed.like` record `like.uri` points at, from the
 * authenticated account's repo.
 *
 * @remarks
 * Deletes exactly the record whose URI you give. The SDK does not scan the repository, ask an
 * indexer or read the liked record, so it does not look for other likes of the same record: after
 * a duplicate (see {@link like}), the other like stays until you delete it with its own URI. The
 * liked record does not have to exist any more.
 *
 * Where the record comes from: what {@link like} returned, `{ uri, cid }`, which can be passed as it is
 * (keep it), or the Hypercerts
 * API, for example `app.certified.feed.getActorReactions`, which returns the like's `uri` and
 * `cid`. It is the URI of the like record, not the URI of the record that was liked.
 *
 * The PDS treats deleting a record that does not exist as nothing to do and answers success, so a
 * stale URI is harmless and the call is safe to repeat. The call does not say whether it removed
 * anything.
 *
 * `cid` is optional. With it, the PDS deletes the like only if it still has that CID; without it,
 * the like is deleted whatever its version.
 *
 * The session needs permission to delete `app.certified.feed.like` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's own records can be deleted.
 * @param input - The like record, `{ uri, cid? }`, as {@link like} returned it. See {@link UnlikeInput}.
 * @returns Nothing. It resolves when the PDS confirmed the deletion or that the record is absent.
 * @throws {@link TypeError} If `input` has an unknown field, a `like.uri` that is not a full record
 * URI, one whose collection is not `app.certified.feed.like` or that is in another account's
 * repository, or a `cid` that is not a CID string. Nothing was sent.
 * @throws {@link Error} If the client is not authenticated. Nothing was sent.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the like no longer has the given `cid`, so it was not deleted.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is safe.
 *
 * @example
 * ```ts
 * import { like, unlike } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const liked = await like(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * // Keep `liked` (its `uri` and `cid`) to undo it later.
 * await unlike(context, { like: liked });
 * ```
 *
 * @example The like's URI, not the URI of the liked record
 * ```ts
 * import { unlike } from "@hypercerts-org/sdk/social";
 *
 * // TypeError: this is the activity, not an app.certified.feed.like record.
 * await unlike(context, {
 *   like: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
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
 * Nothing is deduplicated: calling this again for the same record creates a second repost.
 * {@link unrepost} deletes only the record whose URI it is given, so each duplicate has to be undone
 * with its own URI.
 *
 * `via` is optional: `{ uri }` of the record through which the target was encountered, typically
 * another repost. The SDK reads it the same way. See {@link ActionOptions}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The record to repost and optional `createdAt` and `via`. See
 * {@link RecordActionInput}.
 * @returns The new repost's URI and CID (not the target's).
 * @throws {@link TypeError} If `input` has an unknown field, a `target.uri` that is not a full record
 * URI (a bare DID, a handle authority or a partial URI), a `via.uri` that is not a record URI, or a
 * `createdAt` the lexicon rejects. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the target or the `via` record cannot
 * be read (missing, or the PDS cannot be reached). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second repost if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { repost } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const reposted = await repost(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * console.log(reposted.uri); // at://<your DID>/app.certified.feed.repost/<tid>
 * ```
 *
 * @example Reposting something found through another repost
 * ```ts
 * import { repost } from "@hypercerts-org/sdk/social";
 *
 * await repost(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *   via: { uri: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9" }, // read and pinned for you
 * });
 * ```
 */
export const repost = createAction(repostAction);

/**
 * Removes a repost: deletes the `app.certified.feed.repost` record `repost.uri` points at, from the
 * authenticated account's repo.
 *
 * @remarks
 * Deletes exactly the record whose URI you give. The SDK does not scan the repository, ask an
 * indexer or read the reposted record, so it does not look for other reposts of the same record:
 * after a duplicate (see {@link repost}), the other repost stays until you delete it with its own
 * URI. The reposted record does not have to exist any more.
 *
 * Where the record comes from: what {@link repost} returned, `{ uri, cid }`, which can be passed as it is
 * (keep it), or the Hypercerts
 * API, for example `app.certified.feed.getActorReactions`, which returns the repost's `uri` and
 * `cid`. It is the URI of the repost record, not the URI of the record that was reposted.
 *
 * The PDS treats deleting a record that does not exist as nothing to do and answers success, so a
 * stale URI is harmless and the call is safe to repeat. The call does not say whether it removed
 * anything.
 *
 * `cid` is optional. With it, the PDS deletes the repost only if it still has that CID; without it,
 * the repost is deleted whatever its version.
 *
 * The session needs permission to delete `app.certified.feed.repost` records.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; only that account's own records can be deleted.
 * @param input - The repost record, `{ uri, cid? }`, as {@link repost} returned it. See {@link UnrepostInput}.
 * @returns Nothing. It resolves when the PDS confirmed the deletion or that the record is absent.
 * @throws {@link TypeError} If `input` has an unknown field, a `repost.uri` that is not a full record
 * URI, one whose collection is not `app.certified.feed.repost` or that is in another account's
 * repository, or a `cid` that is not a CID string. Nothing was sent.
 * @throws {@link Error} If the client is not authenticated. Nothing was sent.
 * @throws {@link WriteRejectedError} If the PDS refused the deletion (HTTP 4xx). With `code`
 * `"InvalidSwap"` the repost no longer has the given `cid`, so it was not deleted.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is safe.
 *
 * @example
 * ```ts
 * import { repost, unrepost } from "@hypercerts-org/sdk/social";
 *
 * // `context` comes from createSDKContext.
 * const reposted = await repost(context, {
 *   target: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * // Keep `reposted` (its `uri` and `cid`) to undo it later.
 * await unrepost(context, { repost: reposted });
 * ```
 *
 * @example The repost's URI, not the URI of the reposted record
 * ```ts
 * import { unrepost } from "@hypercerts-org/sdk/social";
 *
 * // TypeError: this is the activity, not an app.certified.feed.repost record.
 * await unrepost(context, {
 *   repost: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * ```
 */
export const unrepost = undoAction(repostAction);
