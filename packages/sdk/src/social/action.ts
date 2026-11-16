import { type CidString, type DidString, isCidString, isDidString, l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { strictObject } from "../internal/input.js";
import { parseRecordUri, resolveRecordRef } from "../internal/resolve-record-ref.js";

/** Options every operation that creates a social record accepts besides its target. */
export interface ActionOptions {
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
  /**
   * The record through which the target was found, for example a starter pack or a repost, as a
   * record URI: `at://<did>/<collection>/<rkey>`. The SDK reads the record to pin its current
   * version and stores it as a strong reference, so callers never build one. It may be a record of
   * any Lexicon and of any account if it is public. A handle in place of the DID is rejected, and
   * so is a record that cannot be read: nothing is written then.
   */
  via?: string | undefined;
}

/** The input of {@link followAccount}. */
export interface FollowAccountInput extends ActionOptions {
  /**
   * The account to follow, as a DID (`did:plc:...` or `did:web:...`). A handle, a record URI or an
   * object is rejected. Stored as given and never looked up: the SDK does not check that the
   * account exists.
   */
  targetDid: DidString;
}

/** The input of {@link followEntity}, {@link like} and {@link repost}. */
export interface RecordActionInput extends ActionOptions {
  /**
   * The record the action is about, as a full record URI: `at://<did>/<collection>/<rkey>`, with a
   * DID (not a handle) as the authority. A bare DID or a URI without a collection and record key is
   * rejected; to follow an account, use {@link followAccount}. The record may be of any Lexicon.
   *
   * {@link followEntity} stores the URI as given and does not read the record, so a record that
   * does not exist is followed all the same. {@link like} and {@link repost} store the record's
   * CID, so they read it and pin the version they find; a record that cannot be read stops them.
   */
  targetUri: string;
}

/** What the undo operations accept besides the URI of the record to delete. */
export interface UndoOptions {
  /**
   * The CID of the record to delete, as returned with its URI (by the create function, or by the
   * Hypercerts API or an indexer). When given, the PDS deletes the record only if it still has this
   * CID, so a record that was replaced in the meantime is not deleted. Absent: the record is deleted
   * whatever its version. A string that is not a CID is rejected.
   */
  cid?: string | undefined;
}

/** The input of {@link unfollowAccount}. */
export interface UnfollowAccountInput extends UndoOptions {
  /**
   * The URI of the `app.certified.graph.follow` record to delete, in the signed-in account's
   * repository: `at://<your DID>/app.certified.graph.follow/<rkey>`. It is the follow record's URI,
   * not the followed account's DID.
   */
  followUri: string;
}

/** The input of {@link unfollowEntity}. */
export interface UnfollowEntityInput extends UndoOptions {
  /**
   * The URI of the `app.certified.graph.entityFollow` record to delete, in the signed-in account's
   * repository. It is the follow record's URI, not the URI of the record that is followed.
   */
  followUri: string;
}

/** The input of {@link unlike}. */
export interface UnlikeInput extends UndoOptions {
  /**
   * The URI of the `app.certified.feed.like` record to delete, in the signed-in account's
   * repository. It is the like's URI, not the URI of the record that was liked.
   */
  likeUri: string;
}

/** The input of {@link unrepost}. */
export interface UnrepostInput extends UndoOptions {
  /**
   * The URI of the `app.certified.feed.repost` record to delete, in the signed-in account's
   * repository. It is the repost's URI, not the URI of the record that was reposted.
   */
  repostUri: string;
}

/** A function that deletes one of the account's own social records, as {@link unlike} does. */
export type UndoFunction<TInput extends UndoOptions> = (
  context: SDKContext,
  input: TInput,
) => Promise<void>;

/** What an undo input is after validation: the same, with the `cid` known to be a CID. */
export type ValidatedUndoInput<TInput extends UndoOptions> = TInput & {
  cid?: CidString | undefined;
};

/**
 * What differs between the four social actions. The shared create and undo logic is driven by one
 * of these (see `createAction` and `undoAction`).
 *
 * Internal. `TCreate` is the input of the create function and `TUndo` the input of the undo
 * function.
 */
export interface SocialAction<TCreate extends ActionOptions, TUndo extends UndoOptions> {
  /** The public functions' names, for error messages. */
  readonly names: { readonly create: string; readonly undo: string };
  /** The lexicon's record schema; its NSID is the only collection the action touches. */
  readonly schema: l.RecordSchema;
  /** Validates the input of the create function. */
  readonly createInput: l.Schema<TCreate>;
  /** The value stored in the record's `subject` for the input's target. */
  readonly subject: (context: SDKContext, input: TCreate) => unknown;
  /** Validates the input of the undo function. */
  readonly undoInput: l.Schema<ValidatedUndoInput<TUndo>>;
  /** The URI of the record to delete, from the undo function's input. */
  readonly undoUri: (input: TUndo) => string;
}

const options = {
  createdAt: l.optional(l.string()),
  via: l.optional(
    l.custom<string>(
      isRecordUri,
      "must be a record URI, at://<did>/<collection>/<rkey>, with a DID (not a handle) as the authority",
    ),
  ),
};

const accountDid = l.custom<DidString>(
  isDidString,
  "must be an account DID such as did:plc:abc123, not a handle, a record URI or an object",
);

const recordUri = l.custom<string>(
  isRecordUri,
  "must be a full record URI, at://<did>/<collection>/<rkey>, with a DID (not a handle) as the authority; a bare DID or a URI without a collection and record key is not accepted",
);

/** Validates the input of an action whose target is an account: `{ targetDid }`. */
export const accountCreateInput = strictObject({ targetDid: accountDid, ...options });

/** Validates the input of an action whose target is a record: `{ targetUri }`. */
export const recordCreateInput = strictObject({ targetUri: recordUri, ...options });

const cid = l.optional(
  l.custom<CidString>(
    isCidString,
    "must be a CID string such as bafyreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju, as returned with the record's URI",
  ),
);

// The undo inputs only check that the URI is a record URI. That it is in the right collection and
// repository is checked by `undoAction`, which knows the signed-in account.

/** Validates the input of {@link unfollowAccount} and {@link unfollowEntity}. */
export const followUndoInput = strictObject({ followUri: recordUri, cid });

/** Validates the input of {@link unlike}. */
export const likeUndoInput = strictObject({ likeUri: recordUri, cid });

/** Validates the input of {@link unrepost}. */
export const repostUndoInput = strictObject({ repostUri: recordUri, cid });

// `parseRecordUri` is the one definition of a record URI; it reports by throwing.
function isRecordUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseRecordUri(value, "isRecordUri");
    return true;
  } catch {
    return false;
  }
}

/**
 * The action of a record whose `subject` is a strong reference to the target: a like or a repost.
 * Creating one pins the version of the target current at the time.
 */
export function recordRefAction<TUndo extends UndoOptions>(
  names: SocialAction<RecordActionInput, TUndo>["names"],
  schema: l.RecordSchema,
  undo: Pick<SocialAction<RecordActionInput, TUndo>, "undoInput" | "undoUri">,
): SocialAction<RecordActionInput, TUndo> {
  return {
    names,
    schema,
    createInput: recordCreateInput,
    subject: (context, { targetUri }) => resolveRecordRef(context, targetUri),
    ...undo,
  };
}
