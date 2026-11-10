import { l } from "@atproto/lex";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { createStandalone, type StandaloneCreator } from "../internal/create-record.js";
import { optionalMedia } from "../internal/input.js";
import { mediaTransform } from "../internal/media.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";

/** The data of a new `org.hypercerts.claim.rights` record. */
export interface RightsInput {
  /** Human-readable name, for example `CC BY-SA 4.0`. At most 100 characters. */
  rightsName: string;
  /** Short code for filtering, for example `CC-BY-SA`. At most 10 characters. */
  rightsType: string;
  /** What the rights holders may and may not do. At most 1000 characters. */
  rightsDescription: string;
  /**
   * A document that defines the rights further: a `Blob` or `File` (up to 10 MB) that the SDK
   * uploads, or a URL string that is stored as it is.
   */
  attachment?: Blob | string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

export const rightsKind: RecordKind<RightsInput> = recordKind(
  rights.main,
  {
    rightsName: l.string(),
    rightsType: l.string(),
    rightsDescription: l.string(),
    attachment: optionalMedia,
  },
  { attachment: mediaTransform("blob") },
);

/**
 * Creates a rights record (`org.hypercerts.claim.rights`) in the authenticated account's repo.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 * A `Blob` attachment is uploaded before the record is written; a URL string is stored as it is
 * and never fetched. Blobs are uploaded before the write and are not rolled back if it fails; see
 * {@link uploadBlob}.
 *
 * Nothing is looked up or deduplicated: calling this twice creates two records. To use a rights
 * record that already exists, pass its URI as `rights` to {@link createActivity} instead.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The rights data. See {@link RightsInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field or a value the lexicon does not
 * allow, for example a `rightsName` over 100 characters. Nothing was written. Blobs may already have been uploaded when a lexicon rule rejects the record.
 * @throws {@link Error} If the client is not authenticated, or the attachment upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not exist. It carries the URI to check; the SDK does not retry.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createRights } from "@hypercerts-org/sdk/activity";
 *
 * // `context` comes from createSDKContext.
 * const rights = await createRights(context, {
 *   rightsName: "CC BY 4.0",
 *   rightsType: "CC-BY",
 *   rightsDescription: "Free to share and adapt with attribution.",
 *   attachment: "https://creativecommons.org/licenses/by/4.0/legalcode",
 * });
 * console.log(rights.uri, rights.cid);
 * ```
 */
export const createRights: StandaloneCreator<RightsInput> = (context, input) =>
  createStandalone(context, "createRights", rightsKind, input);
