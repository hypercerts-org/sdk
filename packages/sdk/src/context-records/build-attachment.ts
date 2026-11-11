import { l } from "@atproto/lex";
import * as attachment from "@hypercerts-org/lexicon/org/hypercerts/context/attachment";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import { optionalText } from "../internal/input.js";
import { type RecordKind, recordKind, references } from "../internal/record-kind.js";
import type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
import type { LocationInput } from "../location/build-location.js";
import {
  type VocabularyTagInput,
  type VocabularyTagResult,
  vocabularyTagKind,
} from "../tag/build-tag.js";
import {
  contentInput,
  contentTransform,
  creatorOf,
  existingRecordsReference,
  locationReference,
} from "./shared.js";

/** The data of a new `org.hypercerts.context.attachment` record. */
export interface AttachmentInput {
  /** A display title, for example `Impact Assessment Report`. At most 256 characters. */
  title: string;
  /**
   * The records the attachment is about, at most 100, each `{ uri }` of an existing record of any
   * type: an Activity, a Collection, a measurement, an evaluation, another attachment, an account
   * profile. Pinned by the CID read before the write and never modified. Omit it for an attachment
   * recorded before the claim it will support.
   */
  subjects?: readonly ExistingRecord[] | undefined;
  /**
   * The kind of attachment, for example `update`, `report`, `audit`, `evidence`, `testimonial` or
   * `methodology`. Other values are accepted. At most 64 characters.
   */
  contentType?: string | undefined;
  /**
   * The files and links in the attachment, at most 100, in order: each `Blob` or `File` (up to
   * 10 MB, any type) is uploaded by the SDK, and each string is stored as a URL and never fetched.
   */
  content?: readonly (Blob | string)[] | undefined;
  /** A summary for previews. At most 3000 characters and 300 graphemes. */
  shortDescription?: string | undefined;
  /** A long description as plain text or Markdown. */
  description?: string | undefined;
  /** Languages of the text fields as BCP-47 tags (up to three), for example `["en"]`. */
  langs?: readonly string[] | undefined;
  /**
   * Where the attachment's subject matter occurred: the data of a new location or `{ uri }` of an
   * existing one.
   */
  location?: LocationInput | ExistingRecord | undefined;
  /**
   * The vocabulary tags that classify the attachment, at most 20, all applying at once: each entry
   * is the data of a new vocabulary tag, which gets the record key `<category>.<key>`, or `{ uri }`
   * of an existing one.
   */
  tags?: readonly (VocabularyTagInput | ExistingRecord)[] | undefined;
  /**
   * An ISO 8601 date-time with a timezone: when the attached material was captured, for example
   * when a photo was taken. Not `createdAt`; omit it when it is unknown.
   */
  capturedAt?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/**
 * The result of {@link createAttachment}: the new Attachment's URI and CID with `created: true`,
 * and the results for the records it points at.
 *
 * @remarks
 * `subjects`, `location` and `tags` mirror the input and appear only when the input had them.
 * Each entry belongs to the input entry at the same index, whether it was created or reused, and
 * a new tag nested in a new tag (`broader`) is reported under it. Filter on `created` for only the
 * records this call wrote.
 */
export interface CreateAttachmentResult extends SupportingRecordRef {
  /** The subjects with the CIDs they were pinned at. `created` is `false` for each. */
  subjects?: readonly SupportingRecordRef[];
  /** The location. */
  location?: SupportingRecordRef;
  /** The vocabulary tags, in input order. */
  tags?: readonly VocabularyTagResult[];
}

const attachmentKind: RecordKind<AttachmentInput> = recordKind(
  attachment.main,
  {
    title: l.string(),
    contentType: optionalText,
    content: contentInput,
    shortDescription: optionalText,
    description: optionalText,
    langs: l.optional(l.array(l.string())),
    capturedAt: optionalText,
  },
  {
    content: contentTransform,
    description: (_build, _field, value: string) =>
      Promise.resolve(defs.descriptionString.build({ value })),
  },
  {
    references: {
      subjects: existingRecordsReference,
      location: locationReference,
      tags: references.many(() => vocabularyTagKind),
    },
  },
);

/**
 * Creates an Attachment (`org.hypercerts.context.attachment`), commentary, evidence or documents
 * about other records, together with the location and tags it needs, in one atomic write.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 *
 * `subjects` is optional and is not limited to Activities: each entry is `{ uri }` of an existing
 * record of any type. The SDK reads each one for its current CID and stores a strong reference
 * to it. The subjects are never modified and do not learn about the attachment; nothing links an
 * existing attachment to a subject afterwards.
 *
 * `content` takes files and links in one array. A `Blob` or `File` is uploaded before the write
 * and needs a `type` (wrap a `File` that has none: `new Blob([file], { type })`); a string is
 * stored as a URL and never fetched. `location` and each `tags` entry is either a new record's
 * fields or `{ uri }` of an existing record of the right type, which is reused as it is. A new tag
 * can have its own `broader` and `supersededBy` tags (see {@link createVocabularyTag}). Nothing is
 * deduplicated, and order is kept.
 *
 * A new tag's record key is `<category>.<key>`, so the SDK checks first that no such tag exists and
 * throws {@link RecordAlreadyExistsError} if one does. To use an existing tag, pass its `uri`.
 *
 * Everything is created in one write: all the records exist afterwards, or none do. An attachment
 * with no new location or tag is a write of one record. One write holds at most 200 records. The
 * OAuth session needs `create` on the attachment, tag and location collections it writes to.
 *
 * Files (`Blob` or `File` values) are uploaded: the `content` entries, a new tag's
 * `referenceDocument` and a new location's `{ blob }`. Blobs are uploaded before the write and are
 * not rolled back if it fails; see {@link uploadBlob}. A lexicon rule that rejects a record (for
 * example more than 100 `content` entries) is found only after the uploads.
 *
 * Not supported: the lexicon's `signatures` and `shortDescriptionFacets`, a `description` that is
 * not a string, and a blob that was uploaded already.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The attachment and the records it needs. See {@link AttachmentInput}.
 * @returns The new Attachment's URI and CID with `created: true`, and the references of its
 * location and tags. See {@link CreateAttachmentResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `content` entry that is neither a
 * `Blob` nor a string, a file the lexicon does not allow (over 10 MB), a mixed or wrongly typed
 * entry (a `tags` URI that points at another record type, `{ uri }` combined with record fields,
 * a `subjects` entry that is not `{ uri }`), two new tags with the same key, more new records than
 * one write holds, or any value the lexicon does not allow. The message names the field. Nothing
 * was written. Blobs may already have been uploaded when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, a `subjects` or other existing record
 * cannot be read, the key of a new tag cannot be checked, or an upload fails. Nothing was written.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second Attachment under a new key if the first attempt had
 * succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example An evidence report with a file, a link, a new tag and a new location
 * ```ts
 * import { createAttachment } from "@hypercerts-org/sdk/context";
 *
 * // `context` comes from createSDKContext; `report` is a File from an <input type="file">.
 * const attachment = await createAttachment(context, {
 *   title: "Field survey, June 2026",
 *   contentType: "evidence",
 *   subjects: [{ uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" }],
 *   content: [report, "https://example.org/survey/2026-06"], // uploaded, stored as a URL
 *   tags: [
 *     { category: "evidence-kind", key: "survey", name: "Survey", status: "accepted" }, // created
 *     { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/land-cover.wetland" }, // reused
 *   ],
 *   location: {
 *     lpVersion: "1.0",
 *     srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *     locationType: "coordinate-decimal",
 *     location: { string: "90.17,27.47" },
 *   }, // created
 *   capturedAt: "2026-06-12T09:30:00+06:00",
 * });
 * console.log(attachment.uri, attachment.tags?.[0]); // { uri, cid, created: true }
 * ```
 *
 * @example An attachment with no subject, recorded before the claim it will support
 * ```ts
 * import { createAttachment } from "@hypercerts-org/sdk/context";
 *
 * await createAttachment(context, { title: "Baseline photos", content: ["https://example.org/photos"] });
 * ```
 *
 * @example A subject is `{ uri }`, not a bare string
 * ```ts
 * import { createAttachment } from "@hypercerts-org/sdk/context";
 *
 * await createAttachment(context, {
 *   title: "Comment",
 *   // TypeError: subjects[0] must be { uri } of an existing record
 *   subjects: ["at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8"],
 * });
 * ```
 */
export const createAttachment = creatorOf<AttachmentInput, CreateAttachmentResult>(
  "createAttachment",
  attachmentKind,
);
