import { l, type UriString } from "@atproto/lex";
import * as acknowledgement from "@hypercerts-org/lexicon/org/hypercerts/context/acknowledgement";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import { optionalText } from "../internal/input.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";
import {
  type ExistingRecord,
  isExistingRecord,
  type SupportingRecordRef,
} from "../internal/slots.js";
import { creatorOf, existingRecordInput, existingRecordReference } from "./shared.js";

/** The data of a new `org.hypercerts.context.acknowledgement` record. */
export interface AcknowledgementInput {
  /**
   * The record being acknowledged: `{ uri }` of an existing record of any type (an Activity, a
   * contributor-information record, an evaluation, ...). Pinned by the CID read before the write
   * and never modified.
   */
  subject: ExistingRecord;
  /** `true` to acknowledge the relationship, `false` to reject it. */
  acknowledged: boolean;
  /**
   * What the acknowledgement is in the context of, for example the Collection that includes an
   * Activity, or the Activity that includes a contributor:
   * - a string is stored as a URI as it is: a lightweight reference that is never fetched and has
   *   no CID, so it does not pin a version;
   * - `{ uri }` of an existing record is stored as a strong reference, pinned by the CID read
   *   before the write, so the acknowledgement says which version of it was meant.
   */
  context?: string | ExistingRecord | undefined;
  /** An optional plain-text comment. At most 10000 characters and 1000 graphemes. */
  comment?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/**
 * The result of {@link createAcknowledgement}: the new Acknowledgement's URI and CID with
 * `created: true`, and the CIDs of the records it points at.
 *
 * @remarks
 * `subject` is always present, and `context` only when the input's `context` was `{ uri }`. Both
 * have `created: false`: an acknowledgement creates no record besides itself.
 */
export interface CreateAcknowledgementResult extends SupportingRecordRef {
  /** The subject with the CID it was pinned at. */
  subject: SupportingRecordRef;
  /** The context with the CID it was pinned at, when `context` was `{ uri }`. */
  context?: SupportingRecordRef;
}

const contextInput = l.custom<string | ExistingRecord>(
  (value): value is string | ExistingRecord => typeof value === "string" || isExistingRecord(value),
  "must be a URI string, stored as it is, or { uri } of an existing record, stored as a strong reference",
);

const acknowledgementKind: RecordKind<AcknowledgementInput> = recordKind(
  acknowledgement.main,
  {
    subject: existingRecordInput,
    acknowledged: l.boolean(),
    context: l.optional(contextInput),
    comment: optionalText,
  },
  {
    // A `{ uri }` arrives here already stored as a strong reference (see `typed` below).
    context: (_build, _field, value: string | object) =>
      Promise.resolve(
        typeof value === "string" ? defs.uri.build({ uri: value as UriString }) : value,
      ),
  },
  {
    references: {
      subject: existingRecordReference,
      // Only `{ uri }` is a reference. The union has the strong reference as a member, so it is
      // stored with its `$type`.
      context: { kind: undefined, many: false, when: isExistingRecord, typed: true },
    },
  },
);

/**
 * Creates an Acknowledgement (`org.hypercerts.context.acknowledgement`), the acknowledging side
 * of a link between two records, in the authenticated account's repo.
 *
 * @remarks
 * The acknowledgement is always written to the signed-in account's repo. There is no way to write
 * one on behalf of another account, and the SDK does not check that the account has any
 * relationship to the subject: that is for whoever reads the acknowledgement to judge. The
 * acknowledged record is not modified and does not learn about it.
 *
 * `subject` is `{ uri }` of an existing record of any type; the SDK reads it for its current CID
 * and stores a strong reference. `acknowledged: false` records a rejection. `context` is a URI
 * string, stored as it is and never fetched, or `{ uri }` of an existing record, stored as a strong
 * reference pinned to its current CID; use `{ uri }` when the acknowledgement should name the
 * version it was about. Both alternatives are optional.
 *
 * The record key is a new TID chosen by the SDK, so acknowledging the same subject twice creates
 * two records; nothing is looked up or deduplicated. `createdAt` defaults to the time of the call.
 * An acknowledgement has no location or tag fields.
 *
 * Not supported: the lexicon's `signatures`.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the record is created in that account's repo.
 * @param input - The acknowledgement. See {@link AcknowledgementInput}.
 * @returns The new record's URI and CID with `created: true`, and the CIDs its `subject` and
 * `{ uri }` `context` were pinned at. See {@link CreateAcknowledgementResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `subject` that is not `{ uri }`, an
 * `acknowledged` that is not a boolean, a `context` that is neither a string nor `{ uri }` (or
 * combines `uri` with other fields), or any value the lexicon does not allow, for example a
 * `context` string that is not a URI. The message names the field. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, or the `subject` or `context` record
 * cannot be read. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not exist. It carries the URI to check; the SDK does not retry, because a retry would
 * create a second acknowledgement under a new key if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example A contributor acknowledges being included in an Activity
 * ```ts
 * import { createAcknowledgement } from "@hypercerts-org/sdk/context";
 *
 * // `context` comes from createSDKContext, signed in as the contributor.
 * const acknowledgement = await createAcknowledgement(context, {
 *   subject: { uri: "at://did:plc:abc123/org.hypercerts.claim.contributorInformation/3k2a4b5c6d7e8" },
 *   context: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e9" }, // pinned by CID
 *   acknowledged: true,
 * });
 * console.log(acknowledgement.uri, acknowledgement.subject); // { uri, cid, created: false }
 * ```
 *
 * @example Rejecting, with a lightweight context
 * ```ts
 * import { createAcknowledgement } from "@hypercerts-org/sdk/context";
 *
 * await createAcknowledgement(context, {
 *   subject: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e9" },
 *   context: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8", // a URI, not pinned
 *   acknowledged: false,
 *   comment: "This activity is not part of our collection.",
 * });
 * ```
 */
export const createAcknowledgement = creatorOf<AcknowledgementInput, CreateAcknowledgementResult>(
  "createAcknowledgement",
  acknowledgementKind,
);
