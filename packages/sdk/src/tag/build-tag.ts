import { l, type RecordKeyString } from "@atproto/lex";
import * as vocabularyTag from "@hypercerts-org/lexicon/org/hypercerts/vocab/tag";
import * as workScopeTag from "@hypercerts-org/lexicon/org/hypercerts/workscope/tag";
import { createRecordTree, type StandaloneCreator } from "../internal/create-record.js";
import { optionalMedia, optionalText } from "../internal/input.js";
import { mediaTransform } from "../internal/media.js";
import { type RecordKind, recordKind, references } from "../internal/record-kind.js";
import type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";

/**
 * The fields that vocabulary tags and work-scope tags have in common. Documented here once; the
 * two inputs extend it.
 */
export interface TagFields {
  /** A human-readable name. At most 200 characters. */
  name: string;
  /** A definition and notes on scope. At most 10000 characters and 1000 graphemes. */
  description?: string | undefined;
  /**
   * Alternative labels such as translations, abbreviations or synonyms, at most 50 of at most 200
   * characters each. Plain text: they identify nothing, references always point at the record.
   */
  aliases?: readonly string[] | undefined;
  /**
   * URIs of exactly equivalent concepts in external vocabularies (for example Wikidata, ENVO or SDG
   * targets), at most 20.
   */
  sameAs?: readonly string[] | undefined;
  /**
   * A document that defines or explains the tag: a `Blob` or `File` (up to 10 MB) that the SDK
   * uploads, or a URL string that is stored as it is.
   */
  referenceDocument?: Blob | string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/** The input schema of the fields in {@link TagFields}, for `recordKind`. */
const tagFields = {
  name: l.string(),
  description: optionalText,
  aliases: l.optional(l.array(l.string())),
  sameAs: l.optional(l.array(l.string())),
  referenceDocument: optionalMedia,
};

/** The fields of {@link TagFields} that are not stored as given, for `recordKind`. */
const tagTransforms = { referenceDocument: mediaTransform("blob") };

/** The data of a new `org.hypercerts.vocab.tag` record. */
export interface VocabularyTagInput extends TagFields {
  /**
   * The classification axis the term belongs to, for example `land-cover` or `zone-role`. At most
   * 50 characters, a valid record key, and **no dots**: it is the first part of the record key,
   * `<category>.<key>`.
   */
  category: string;
  /**
   * The stable, lowercase machine identifier of the term within its category, for example
   * `mangrove`. At most 120 characters, a valid record key, and **no dots**: it is the second part
   * of the record key, `<category>.<key>`.
   */
  key: string;
  /**
   * The lifecycle status: `proposed`, `accepted` or `deprecated`. Other values are accepted. At
   * most 20 characters. Required, because the SDK does not decide a term's governance status.
   */
  status: string;
  /**
   * The directly broader terms, forming a polyhierarchy, at most 20: each entry is the data of a
   * new vocabulary tag or `{ uri }` of an existing one.
   */
  broader?: readonly (VocabularyTagInput | ExistingRecord)[] | undefined;
  /**
   * The replacement of a deprecated term: the data of a new vocabulary tag, or `{ uri }` of an
   * existing one.
   */
  supersededBy?: VocabularyTagInput | ExistingRecord | undefined;
}

/**
 * What {@link createVocabularyTag} or {@link createFeature} did for a vocabulary tag, and for the
 * tags it points at.
 *
 * @remarks
 * `broader` and `supersededBy` mirror the input and appear only on a tag this call created and
 * only when its input had them. Each entry is a result of the same shape, so a new tag nested at
 * any depth is reported with its URI and CID.
 */
export interface VocabularyTagResult extends SupportingRecordRef {
  broader?: readonly VocabularyTagResult[];
  supersededBy?: VocabularyTagResult;
}

// The record key is `<category>.<key>`, so each part must be a record key and have no dot: with one,
// the key could be read in two ways. Their length is left to the lexicon, which checks it when the
// record is built.
const recordKeyPart = l.refine(l.string({ format: "record-key" }), {
  check: (value: string) => !value.includes("."),
  message:
    "must not contain dots, because the record key is <category>.<key> and a dot would make it ambiguous",
});

export const vocabularyTagKind: RecordKind<VocabularyTagInput> = recordKind(
  vocabularyTag.main,
  {
    category: recordKeyPart,
    key: recordKeyPart,
    status: l.string(),
    ...tagFields,
  },
  tagTransforms,
  {
    references: {
      broader: references.many(() => vocabularyTagKind),
      supersededBy: references.one(() => vocabularyTagKind),
    },
    recordKey: ({ category, key }: VocabularyTagInput) => `${category}.${key}` as RecordKeyString,
  },
);

/**
 * Creates a vocabulary tag (`org.hypercerts.vocab.tag`), a reusable term for classifying Hypercerts
 * records, in the authenticated account's repo, if it does not exist yet.
 *
 * @remarks
 * The record key is `<category>.<key>`, for example `zone-role.site`, used exactly as given. So an
 * account has one tag per category and key. This function only creates; if the key is taken it
 * throws {@link RecordAlreadyExistsError} with the existing tag's URI, which you can pass as
 * `{ uri }` instead.
 *
 * `broader` and `supersededBy` take a new vocabulary tag's fields or `{ uri }` of an existing one,
 * nested to any depth. Two new tags in one call cannot have the same key.
 *
 * OAuth permissions: creating only this tag needs both `create` and `update` on
 * `org.hypercerts.vocab.tag` (the SDK uses `putRecord` so two calls can't overwrite each other);
 * with only `create` it throws {@link WriteRejectedError}. Creating nested tags too needs only
 * `create`, and everything is created in one write of at most 200 records.
 *
 * `createdAt` defaults to the time of the call. A `Blob` in `referenceDocument` is uploaded before
 * the write; if the write fails, it is left unused and the PDS may or may not delete it later.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The tag's data. See {@link VocabularyTagInput}.
 * @returns The new tag's URI and CID with `created: true`, and the results for the tags it points
 * at. See {@link VocabularyTagResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `category` or `key` that is not a
 * valid record key or contains a dot, a `broader` or `supersededBy` entry that is not a tag's data
 * or `{ uri }` (or combines `uri` with other fields, or points at another type of record), two new
 * tags with the same key, more new records than one write holds, or a value the lexicon does not
 * allow. Nothing was written. Blobs may already have been uploaded when a lexicon rule rejects a
 * record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, the
 * key of a new nested tag cannot be checked ("cannot check whether … already exists", nothing was
 * written), or an upload fails.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written and the
 * existing tag is unchanged.
 * @throws {@link WriteRejectedError} If the PDS rejected the write for another reason (HTTP 4xx).
 * Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * records may or may not exist. It lists every URI that was attempted. The SDK does not retry, but
 * calling again is safe, because every tag it creates has a fixed key: the call creates them or
 * throws {@link RecordAlreadyExistsError}, which then means they exist, most likely from the first
 * attempt.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createVocabularyTag } from "@hypercerts-org/sdk/tag";
 *
 * // `context` comes from createSDKContext.
 * const tag = await createVocabularyTag(context, {
 *   category: "land-cover",
 *   key: "mangrove",
 *   name: "Mangrove",
 *   status: "accepted",
 *   broader: [{ category: "land-cover", key: "forest", name: "Forest", status: "accepted" }], // created too
 * });
 * console.log(tag.uri); // at://<did>/org.hypercerts.vocab.tag/land-cover.mangrove
 * ```
 *
 * @example A dot in the category or key is rejected
 * ```ts
 * import { createVocabularyTag } from "@hypercerts-org/sdk/tag";
 *
 * await createVocabularyTag(context, {
 *   category: "land-cover",
 *   key: "mangrove.red", // TypeError: must not contain dots
 *   name: "Red mangrove",
 *   status: "proposed",
 * });
 * ```
 *
 * @example Reuse a tag that already exists
 * ```ts
 * import { createVocabularyTag, RecordAlreadyExistsError } from "@hypercerts-org/sdk/tag";
 *
 * try {
 *   await createVocabularyTag(context, { category: "land-cover", key: "mangrove", name: "Mangrove", status: "accepted" });
 * } catch (error) {
 *   if (!(error instanceof RecordAlreadyExistsError)) throw error;
 *   // `error.uri` is the tag that is already there; pass it as `{ uri }` where a tag is accepted.
 * }
 * ```
 */
export const createVocabularyTag: StandaloneCreator<VocabularyTagInput, VocabularyTagResult> = (
  context,
  input,
) => createRecordTree(context, "createVocabularyTag", vocabularyTagKind, input);

/** The data of a new `org.hypercerts.workscope.tag` record. */
export interface WorkScopeTagInput extends TagFields {
  /**
   * The machine-readable identifier of the scope, lowercase and underscore-separated (for example
   * `mangrove_restoration`). CEL expressions name the tag by it. At most 120 characters.
   */
  key: string;
  /**
   * The kind of scope: `topic`, `language`, `domain` or `method`. Other values are accepted. At
   * most 50 characters.
   */
  category?: string | undefined;
  /** The parent in a hierarchy: the data of a new work-scope tag, or `{ uri }` of an existing one. */
  parent?: WorkScopeTagInput | ExistingRecord | undefined;
  /**
   * The lifecycle status: `proposed`, `accepted` or `deprecated`. Other values are accepted. At
   * most 20 characters. The SDK sets none by default.
   */
  status?: string | undefined;
  /**
   * The replacement of a deprecated tag: the data of a new work-scope tag, or `{ uri }` of an
   * existing one.
   */
  supersededBy?: WorkScopeTagInput | ExistingRecord | undefined;
}

/**
 * What {@link createWorkScopeTag} did for a work-scope tag, and for the tags it points at.
 *
 * @remarks
 * `parent` and `supersededBy` mirror the input and appear only on a tag this call created and only
 * when its input had them. Each is a result of the same shape, so a new tag nested at any depth is
 * reported with its URI and CID.
 */
export interface WorkScopeTagResult extends SupportingRecordRef {
  parent?: WorkScopeTagResult;
  supersededBy?: WorkScopeTagResult;
}

export const workScopeTagKind: RecordKind<WorkScopeTagInput> = recordKind(
  workScopeTag.main,
  { key: l.string(), category: optionalText, status: optionalText, ...tagFields },
  tagTransforms,
  {
    references: {
      parent: references.one(() => workScopeTagKind),
      supersededBy: references.one(() => workScopeTagKind),
    },
  },
);

/**
 * Creates a work-scope tag (`org.hypercerts.workscope.tag`), a reusable scope atom that CEL work
 * scope expressions are built from, in the authenticated account's repo.
 *
 * @remarks
 * Nothing is deduplicated: calling this twice creates two tags, even with the same `key`. To reuse
 * a tag, pass its URI in `usedTags` of {@link createActivity}.
 *
 * `parent` and `supersededBy` take a new work-scope tag's fields or `{ uri }` of an existing one,
 * nested to any depth. Everything is created in one write of at most 200 records: all of it exists
 * afterwards, or none does. `createdAt` defaults to the time of the call.
 *
 * A `Blob` in `referenceDocument` is uploaded before the write; if the write fails, it is left
 * unused and the PDS may or may not delete it later.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The tag's data. See {@link WorkScopeTagInput}.
 * @returns The new tag's URI and CID with `created: true`, and the results for the tags it points
 * at. See {@link WorkScopeTagResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `parent` or `supersededBy` that is
 * not a tag's data or `{ uri }` (or combines `uri` with other fields, or points at another type of
 * record), more new records than one write holds, or a value the lexicon does not allow. Nothing
 * was written. Blobs may already have been uploaded when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, or
 * an upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). None of the records
 * was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * records may or may not exist. It lists every URI that was attempted; the SDK does not retry,
 * because a retry would create duplicates under new keys if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";
 *
 * // `context` comes from createSDKContext.
 * const tag = await createWorkScopeTag(context, {
 *   key: "mangrove_restoration",
 *   name: "Mangrove restoration",
 *   category: "topic",
 *   parent: { key: "ecosystem_restoration", name: "Ecosystem restoration" }, // created too
 * });
 * console.log(tag.uri, tag.parent?.uri);
 * ```
 *
 * @example A vocabulary tag is not a work-scope tag
 * ```ts
 * import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";
 *
 * await createWorkScopeTag(context, {
 *   key: "site",
 *   name: "Site",
 *   // TypeError: this field holds org.hypercerts.workscope.tag
 *   parent: { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/zone-role.site" },
 * });
 * ```
 */
export const createWorkScopeTag: StandaloneCreator<WorkScopeTagInput, WorkScopeTagResult> = (
  context,
  input,
) => createRecordTree(context, "createWorkScopeTag", workScopeTagKind, input);
