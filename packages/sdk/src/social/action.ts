import { type CidString, isCidString, isDidString, l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { strictObject } from "../internal/input.js";
import { resolveRecordRef, tryParseRecordUri } from "../internal/resolve-record-ref.js";

/** A record the action refers to, as `{ uri }`. */
export interface RecordSubject {
  /**
   * A full record URI: `at://<did>/<collection>/<rkey>`, with a DID (not a handle) as the authority.
   * A bare DID or a URI without a collection and record key is rejected.
   */
  uri: string;
}

/** Options every operation that creates a social record accepts besides its subject. */
export interface ActionOptions {
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
  /**
   * The record through which the subject was found, for example a starter pack or a repost, as
   * `{ uri }`: `at://<did>/<collection>/<rkey>`. The SDK reads the record to pin its current
   * version and stores it as a strong reference, so callers never build one. It may be a record of
   * any Lexicon and of any account if it is public. A handle in place of the DID is rejected, and
   * so is a record that cannot be read: nothing is written then.
   */
  via?: RecordSubject | undefined;
}

/** The input of {@link followAccount}. */
export interface FollowAccountInput extends ActionOptions {
  /**
   * The account to follow, as `{ did }` (`did:plc:...` or `did:web:...`). A handle, a record URI
   * or a bare string is rejected. Stored as given and never looked up: the SDK does not check that
   * the account exists.
   */
  subject: { did: string };
}

/** The input of {@link followEntity}, {@link like} and {@link repost}. */
export interface RecordActionInput extends ActionOptions {
  /**
   * The record the action is about, as `{ uri }` with a full record URI. To follow an account, use
   * {@link followAccount}. The record may be of any Lexicon.
   *
   * {@link followEntity} stores the URI as given and does not read the record, so a record that
   * does not exist is followed all the same. {@link like} and {@link repost} store the record's
   * CID, so they read it and pin the version they find; a record that cannot be read stops them.
   */
  subject: RecordSubject;
}

/**
 * The record an undo operation deletes: the `{ uri, cid }` the create function returned, which can
 * be passed as it is.
 */
export interface UndoRecord {
  /**
   * The URI of the record to delete, in the signed-in account's repository. It is the URI of the
   * like, repost or follow record, not the URI of the record or account it points at.
   */
  uri: string;
  /**
   * The CID of the record to delete, as returned with its URI (by the create function, or by the
   * Hypercerts API or an indexer). When given, the PDS deletes the record only if it still has this
   * CID, so a record that was replaced in the meantime is not deleted. Absent: the record is deleted
   * whatever its version. A string that is not a CID is rejected.
   */
  cid?: string | undefined;
}

/** The input of {@link unfollowAccount}: the `app.certified.graph.follow` record to delete. */
export interface UnfollowAccountInput {
  /** The follow record {@link followAccount} returned. */
  follow: UndoRecord;
}

/** The input of {@link unfollowEntity}: the `app.certified.graph.entityFollow` record to delete. */
export interface UnfollowEntityInput {
  /** The follow record {@link followEntity} returned. */
  follow: UndoRecord;
}

/** The input of {@link unlike}: the `app.certified.feed.like` record to delete. */
export interface UnlikeInput {
  /** The like record {@link like} returned. */
  like: UndoRecord;
}

/** The input of {@link unrepost}: the `app.certified.feed.repost` record to delete. */
export interface UnrepostInput {
  /** The repost record {@link repost} returned. */
  repost: UndoRecord;
}

/** The names of the field that holds the record an undo input deletes. */
export type UndoField = "follow" | "like" | "repost";

/** An undo input: the record to delete under the action's field. */
export type UndoInput<TField extends UndoField> = { [K in TField]: UndoRecord };

/** A function that deletes one of the account's own social records, as {@link unlike} does. */
export type UndoFunction<TInput> = (context: SDKContext, input: TInput) => Promise<void>;

/** What an undo input is after validation: the same, with the `cid` known to be a CID. */
type ValidatedUndoInput<TField extends UndoField> = {
  [K in TField]: { uri: string; cid?: CidString | undefined };
};

/**
 * What differs between the four social actions. The shared create and undo logic is driven by one
 * of these (see `createAction` and `undoAction`).
 *
 * `TCreate` is the input of the create function and `TField` the field of the undo
 * function's input that holds the record to delete.
 */
export interface SocialAction<TCreate extends ActionOptions, TField extends UndoField> {
  /** The public functions' names, for error messages. */
  readonly names: { readonly create: string; readonly undo: string };
  /** The lexicon's record schema; its NSID is the only collection the action touches. */
  readonly schema: l.RecordSchema;
  /** Validates the input of the create function. */
  readonly createInput: l.Schema<TCreate>;
  /** The value stored in the record's `subject` for the input's subject. */
  readonly subject: (context: SDKContext, input: TCreate) => unknown;
  /** The field of the undo function's input that holds the record to delete. */
  readonly undoField: TField;
}

const accountDid = l.custom<string>(
  isDidString,
  "must be an account DID such as did:plc:abc123, not a handle, a record URI or an object",
);

const recordUri = l.custom<string>(
  isRecordUri,
  "must be a full record URI, at://<did>/<collection>/<rkey>, with a DID (not a handle) as the authority; a bare DID or a URI without a collection and record key is not accepted",
);

const recordSubjectInput = strictObject({ uri: recordUri });

const options = {
  createdAt: l.optional(l.string()),
  via: l.optional(recordSubjectInput),
};

/** Validates the input of an action whose subject is an account: `{ subject: { did } }`. */
export const accountCreateInput = strictObject({
  subject: strictObject({ did: accountDid }),
  ...options,
});

/** Validates the input of an action whose subject is a record: `{ subject: { uri } }`. */
export const recordCreateInput = strictObject({ subject: recordSubjectInput, ...options });

const cid = l.optional(
  l.custom<CidString>(
    isCidString,
    "must be a CID string such as bafyreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju, as returned with the record's URI",
  ),
);

// The undo inputs only check that the URI is a record URI. That it is in the right collection and
// repository is checked by `undoAction`, which knows the signed-in account.

/** Validates the input of an undo function: `{ [field]: { uri, cid? } }`. */
export function undoInputSchema<TField extends UndoField>(
  field: TField,
): l.Schema<ValidatedUndoInput<TField>> {
  return strictObject({ [field]: strictObject({ uri: recordUri, cid }) }) as never;
}

function isRecordUri(value: unknown): value is string {
  return typeof value === "string" && tryParseRecordUri(value) !== undefined;
}

/**
 * The action of a record whose `subject` is a strong reference to the subject: a like or a repost.
 * Creating one pins the version of the subject current at the time.
 */
export function recordRefAction<TField extends UndoField>(
  names: SocialAction<RecordActionInput, TField>["names"],
  schema: l.RecordSchema,
  undoField: TField,
): SocialAction<RecordActionInput, TField> {
  return {
    names,
    schema,
    createInput: recordCreateInput,
    subject: (context, { subject }) => resolveRecordRef(context, subject.uri, names.create),
    undoField,
  };
}
