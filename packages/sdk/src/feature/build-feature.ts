import { l } from "@atproto/lex";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import * as feature from "@hypercerts-org/lexicon/org/hypercerts/entity/feature";
import * as linearDocument from "@hypercerts-org/lexicon/pub/leaflet/pages/linearDocument";
import type { SDKContext } from "../context.js";
import { createRecordTree } from "../internal/create-record.js";
import { optionalText } from "../internal/input.js";
import { type RecordKind, recordKind, references } from "../internal/record-kind.js";
import {
  type ExistingRecord,
  isExistingRecord,
  type SupportingRecordRef,
} from "../internal/slots.js";
import { type LocationInput, locationKind } from "../location/build-location.js";
import type { VocabularyTagResult } from "../tag/build-tag.js";
import { type VocabularyTagInput, vocabularyTagKind } from "../tag/build-tag.js";

/**
 * A Leaflet document (`pub.leaflet.pages.linearDocument`): rich text in blocks. Passed to the record
 * as it is; the lexicon validates it.
 */
export type LeafletDocument = l.$Typed<linearDocument.Main>;

/** The data of a new `org.hypercerts.entity.feature` record. */
export interface FeatureInput {
  /**
   * The coarse kind of subject: `zone` (an area a steward authors and manages) or `stratum` (an
   * analytical unit derived from a model or methodology). Other values are accepted. At most 64
   * characters. This is not the feature's role: that is what `tags` express.
   */
  type?: string | undefined;
  /** The display name. At most 800 characters and 80 graphemes. */
  title: string;
  /**
   * A long description: plain text, a {@link LeafletDocument}, or `{ uri }` of an existing record
   * of any type, stored as a reference to it. A string is stored as it is, and a document is stored
   * as it is (it needs its `$type`). The SDK never creates a document record.
   */
  description?: string | LeafletDocument | ExistingRecord | undefined;
  /** Languages of the text fields as BCP-47 tags (up to three), for example `["en"]`. */
  langs?: readonly string[] | undefined;
  /**
   * Published spatial representations of the feature, at most 1000, **most preferred first**: each
   * entry is the data of a new location or `{ uri }` of an existing one. Several entries are
   * alternative representations of the same subject (different precision or encoding), never
   * different places. The order is kept, nothing is deduplicated, and an empty array is valid.
   */
  locations?: readonly (LocationInput | ExistingRecord)[] | undefined;
  /**
   * The vocabulary tags that classify the feature, at most 20, all applying at once: each entry is
   * the data of a new vocabulary tag, which gets the record key `<category>.<key>`, or `{ uri }` of
   * an existing one.
   */
  tags?: readonly (VocabularyTagInput | ExistingRecord)[] | undefined;
  /** URIs of external identifiers that denote the same subject, at most 20, for example a parcel ID. */
  sameAs?: readonly string[] | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/**
 * The result of {@link createFeature}.
 *
 * @remarks
 * `tags[i]` and `locations[i]` belong to the input entry at the same index, whether it was created
 * or reused. A new tag nested in a new tag (`broader`) is reported under it. Filter on `created`
 * for only the records this call wrote.
 */
export interface CreateFeatureResult {
  /** The URI of the new Feature. */
  uri: SupportingRecordRef["uri"];
  /** The CID of the new Feature. */
  cid: SupportingRecordRef["cid"];
  /** The vocabulary tags, in input order. */
  tags: readonly VocabularyTagResult[];
  /** The locations, in input order. */
  locations: readonly SupportingRecordRef[];
}

const isLeafletDocument = (value: unknown): value is LeafletDocument =>
  typeof value === "object" &&
  value !== null &&
  "$type" in value &&
  value.$type === linearDocument.$type;

const featureDescription = l.custom<string | LeafletDocument | ExistingRecord>(
  (value): value is string | LeafletDocument | ExistingRecord =>
    typeof value === "string" || isExistingRecord(value) || isLeafletDocument(value),
  `must be a string, { uri } of an existing record, or a Leaflet document with $type "${linearDocument.$type}"`,
);

const featureKind: RecordKind<FeatureInput> = recordKind(
  feature.main,
  {
    type: optionalText,
    title: l.string(),
    description: l.optional(featureDescription),
    langs: l.optional(l.array(l.string())),
    sameAs: l.optional(l.array(l.string())),
  },
  {
    // A reference arrives here already stored with its `$type` (see `typed` below).
    description: (_build, _field, value: string | object) =>
      Promise.resolve(typeof value === "string" ? defs.descriptionString.build({ value }) : value),
  },
  {
    references: {
      locations: references.many(() => locationKind),
      tags: references.many(() => vocabularyTagKind),
      // Only `{ uri }` is a reference. The description's union has the strong reference as a member,
      // so it is stored with its `$type`.
      description: { kind: undefined, many: false, when: isExistingRecord, typed: true },
    },
  },
);

type FeatureTree = SupportingRecordRef & {
  tags?: readonly VocabularyTagResult[];
  locations?: readonly SupportingRecordRef[];
};

/**
 * Creates a Feature (`org.hypercerts.entity.feature`), a subject such as a land zone or an
 * ecological stratum that other records can be about, together with the tags and locations it needs,
 * in one atomic write.
 *
 * @remarks
 * Each `tags` and `locations` entry says what you want with a tagged choice, so intent is never
 * guessed: the fields of a record create a new one, and `{ uri }` reuses an existing one, whose
 * current CID is read and which is never rewritten. An existing record must be of the type the
 * field holds (`org.hypercerts.vocab.tag` for `tags`, `app.certified.location` for `locations`);
 * a work-scope tag is not a vocabulary tag. A new tag may itself have a new or existing `broader`
 * and `supersededBy` tag, to any depth (see {@link createVocabularyTag}). Nothing is searched for
 * or deduplicated, and the order of both arrays is kept.
 *
 * `description` is a string (stored as the lexicon's `descriptionString`), a Leaflet document
 * (passed as it is and validated by the lexicon; it needs `$type: "pub.leaflet.pages.linearDocument"`),
 * or `{ uri }` of an existing record of any type (its CID is read and a reference is stored). The
 * SDK never creates a document record. `type`, `langs`, `sameAs` and `createdAt` are stored as
 * given; `createdAt` defaults to the time of the call, one timestamp for all the records the call
 * creates.
 *
 * The Feature gets a new TID as its record key, chosen by the SDK. A new vocabulary tag gets the
 * key `<category>.<key>` (see {@link createVocabularyTag}), so it can already be taken. A batch has
 * no "only if absent" option, so before uploading or writing anything the SDK reads each new tag's
 * key with `com.atproto.repo.getRecord`; if one exists it throws {@link RecordAlreadyExistsError}
 * naming its URI, and nothing is written. Two new tags in one call cannot have the same key. To use
 * a tag that exists, or one tag in several places, pass its `uri`.
 *
 * One `com.atproto.repo.applyWrites` request then creates the Feature and every new record, and the
 * PDS commits it as a whole: all of the records exist afterwards or none do. Every record's key and
 * CID are worked out locally first, so there are no intermediate writes. The request holds at most
 * 200 records on the reference PDS, and the SDK does not split a call: a larger one fails before
 * anything is uploaded or written. An OAuth session needs the `create` permission on the Feature,
 * vocabulary tag and location collections the call writes to.
 *
 * Blobs (`Blob` values for a new location's `{ blob }` and a new tag's `referenceDocument`) are
 * uploaded before the write, and URL strings are stored as they are and never fetched. Uploads are
 * not part of the write: if the write fails, this call leaves the uploaded blobs unreferenced. A
 * PDS usually deletes unreferenced blobs after a while, but this is not guaranteed, and a blob with
 * the same content that another record already uses stays. After
 * {@link WriteOutcomeUnknownError} or {@link WriteResultMismatchError} the records may exist, so the
 * blobs may be referenced and publicly readable.
 *
 * Not supported: the lexicon's `signatures`, a blob that was uploaded already, and updating a
 * Feature.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The Feature and the records it needs. See {@link FeatureInput}.
 * @returns The new Feature's URI and CID, and the references of the tags and locations in input
 * order. See {@link CreateFeatureResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a mixed or wrongly typed entry (a
 * `tags` URI that points at another record type, `{ uri }` combined with record fields), a `description` that is none of the three
 * forms or not valid for the lexicon, a tag `category` or `key` with a dot, two new tags with the
 * same key, more new records than one write holds, or any value the lexicons do not allow. The
 * message names the field. Nothing was written. Blobs may already have been uploaded when a lexicon
 * rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, the
 * key of a new tag cannot be checked, or an upload fails.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). None of the records
 * was created and nothing needs cleaning up.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS (network
 * failure, timeout, a server error), so the records may or may not exist. It lists every URI that
 * was attempted. The SDK does not retry, because a retry would create a second Feature under a new
 * key if the first attempt had succeeded. Check the URIs, then decide.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed, so the references between the new records may not match what is stored.
 *
 * @example A Feature with a new tag, an existing tag and a new location
 * ```ts
 * import { createFeature } from "@hypercerts-org/sdk/feature";
 *
 * // `context` comes from createSDKContext.
 * const feature = await createFeature(context, {
 *   type: "zone",
 *   title: "Phobjikha restoration zone",
 *   description: "The valley floor north of the crane centre.",
 *   langs: ["en"],
 *   tags: [
 *     { category: "zone-role", key: "site", name: "Site", status: "accepted" }, // created
 *     { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/land-cover.wetland" }, // reused
 *   ],
 *   locations: [
 *     {
 *       lpVersion: "1.0",
 *       srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *       locationType: "coordinate-decimal",
 *       location: { string: "27.47,90.17" },
 *     }, // created
 *   ],
 * });
 * console.log(feature.uri, feature.tags[0]); // { uri, cid, created: true }
 * ```
 *
 * @example The description can point at an existing record
 * ```ts
 * import { createFeature } from "@hypercerts-org/sdk/feature";
 *
 * await createFeature(context, {
 *   title: "Phobjikha restoration zone",
 *   // Placeholder: the URI of a record you wrote earlier, of any type.
 *   description: { uri: "at://did:plc:abc123/pub.leaflet.document/3k2a4b5c6d7e8" },
 * });
 * ```
 *
 * @example A work-scope tag is not a vocabulary tag
 * ```ts
 * import { createFeature } from "@hypercerts-org/sdk/feature";
 *
 * await createFeature(context, {
 *   title: "Phobjikha restoration zone",
 *   // TypeError: this field holds org.hypercerts.vocab.tag
 *   tags: [{ uri: "at://did:plc:abc123/org.hypercerts.workscope.tag/3k2a4b5c6d7e8" }],
 * });
 * ```
 */
export async function createFeature(
  context: SDKContext,
  input: FeatureInput,
): Promise<CreateFeatureResult> {
  const { uri, cid, tags, locations } = await createRecordTree<FeatureInput, FeatureTree>(
    context,
    "createFeature",
    featureKind,
    input,
  );
  return { uri, cid, tags: tags ?? [], locations: locations ?? [] };
}
