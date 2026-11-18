import { l, type RecordKeyString } from "@atproto/lex";
import * as vocabularyTag from "@hypercerts-org/lexicon/org/hypercerts/vocab/tag";
import * as workScopeTag from "@hypercerts-org/lexicon/org/hypercerts/workscope/tag";
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
export interface CreateVocabularyTagResult extends SupportingRecordRef {
  broader?: readonly CreateVocabularyTagResult[];
  supersededBy?: CreateVocabularyTagResult;
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
export interface CreateWorkScopeTagResult extends SupportingRecordRef {
  parent?: CreateWorkScopeTagResult;
  supersededBy?: CreateWorkScopeTagResult;
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
