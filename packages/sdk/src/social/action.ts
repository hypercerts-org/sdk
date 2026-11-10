import { type DidString, isDidString, l } from "@atproto/lex";
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

/**
 * What an undo operation ({@link unfollowAccount}, {@link unfollowEntity}, {@link unlike} and
 * {@link unrepost}) did.
 *
 * @remarks
 * - `deleted`: the account's repository held exactly one matching record, and it was deleted.
 * - `not-found`: no matching record was found; nothing was deleted. This does not say whether the
 *   action never existed or was removed earlier.
 * - `ambiguous`: `matchCount` matching records were found (always more than one, because the
 *   account created the same action repeatedly); nothing was deleted. The SDK cannot tell which
 *   one is meant, and deleting all of them would be a decision for the caller. Delete the extra
 *   records yourself (for example with `com.atproto.repo.deleteRecord`) and call again.
 *
 * The outcome reflects the records the scan saw. A matching record created by another writer after
 * the scan is not seen, so `deleted` does not promise that no matching record remains, and
 * `not-found` does not promise that none exists a moment later.
 */
export type UndoResult =
  | { status: "deleted" }
  | { status: "not-found" }
  | { status: "ambiguous"; matchCount: number };

/** The input of {@link followAccount}. */
export interface FollowAccountInput extends ActionOptions {
  /**
   * The account to follow, as a DID (`did:plc:...` or `did:web:...`). A handle, a record URI or an
   * object is rejected.
   */
  targetDid: DidString;
}

/** The input of {@link unfollowAccount}. */
export interface UnfollowAccountInput {
  /** The account to stop following, as a DID. A handle, a record URI or an object is rejected. */
  targetDid: DidString;
}

/** The input of {@link followEntity}, {@link like} and {@link repost}. */
export interface RecordActionInput extends ActionOptions {
  /**
   * The record the action is about, as a full record URI: `at://<did>/<collection>/<rkey>`, with a
   * DID (not a handle) as the authority. A bare DID or a URI without a collection and record key is
   * rejected; to follow an account, use {@link followAccount}. The record may be of any Lexicon.
   */
  targetUri: string;
}

/** The input of {@link unfollowEntity}, {@link unlike} and {@link unrepost}. */
export interface RecordTargetInput {
  /**
   * The record to undo the action for, as the full record URI it was done with. For a like or a
   * repost, the version the record pinned does not matter.
   */
  targetUri: string;
}

/** A function that removes one kind of social record, as {@link unfollowAccount} does. */
export type UndoFunction<TInput> = (context: SDKContext, input: TInput) => Promise<UndoResult>;

/**
 * What differs between the four social actions. The shared create and undo logic is driven by one
 * of these (see `createAction` and `undoAction`).
 *
 * Internal. `TUndo` is the input that names the target, `{ targetDid }` or `{ targetUri }`;
 * `TCreate` adds {@link ActionOptions}.
 */
export interface SocialAction<TCreate extends TUndo & ActionOptions, TUndo extends object> {
  /** The public functions' names, for error messages. */
  readonly names: { readonly create: string; readonly undo: string };
  /** The lexicon's record schema; its NSID is the only collection the action touches. */
  readonly schema: l.RecordSchema;
  /** Validates the input of the create function. */
  readonly createInput: l.Schema<TCreate>;
  /** Validates the input of the undo function: the target alone. */
  readonly targetInput: l.Schema<TUndo>;
  /** The value stored in the record's `subject` for `target`. */
  readonly subject: (context: SDKContext, target: TUndo) => unknown;
  /** Whether the `subject` a stored record holds is `target`. */
  readonly isSubject: (stored: unknown, target: TUndo) => boolean;
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

/** The input schemas of an action whose target is an account: `{ targetDid }`. */
export const accountTarget = {
  createInput: strictObject({ targetDid: accountDid, ...options }),
  targetInput: strictObject({ targetDid: accountDid }),
};

/** The input schemas of an action whose target is a record: `{ targetUri }`. */
export const recordTarget = {
  createInput: strictObject({ targetUri: recordUri, ...options }),
  targetInput: strictObject({ targetUri: recordUri }),
};

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
 * The URI in a stored `subject`, whether it is a strong reference or a record subject, or
 * `undefined` for a value that has none. The CID, when there is one, is not looked at.
 */
export function uriOf(stored: unknown): string | undefined {
  if (typeof stored !== "object" || stored === null || !("uri" in stored)) return undefined;
  return typeof stored.uri === "string" ? stored.uri : undefined;
}

/**
 * The action of a record whose `subject` is a strong reference to the target: a like or a repost.
 * Creating one pins the version of the target current at the time; undoing one matches the
 * target's URI whatever version the stored reference pins.
 */
export function recordRefAction(
  names: SocialAction<RecordActionInput, RecordTargetInput>["names"],
  schema: l.RecordSchema,
): SocialAction<RecordActionInput, RecordTargetInput> {
  return {
    names,
    schema,
    ...recordTarget,
    subject: (context, { targetUri }) => resolveRecordRef(context, targetUri),
    isSubject: (stored, { targetUri }) => uriOf(stored) === targetUri,
  };
}
