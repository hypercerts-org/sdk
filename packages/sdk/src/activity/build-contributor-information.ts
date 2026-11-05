import * as contributorInformation from "@hypercerts-org/lexicon/org/hypercerts/claim/contributorInformation";
import { optionalMedia, optionalText } from "../internal/input.js";
import { mediaTransform } from "../internal/media.js";
import {
  createStandalone,
  type RecordKind,
  recordKind,
  type StandaloneCreator,
} from "../internal/record-kind.js";

/** The data of a new `org.hypercerts.claim.contributorInformation` record. */
export interface ContributorInformationInput {
  /** A DID or a URI of a social profile, at most 2048 characters. */
  identifier?: string | undefined;
  /** The name as it should appear in a UI. At most 100 characters. */
  displayName?: string | undefined;
  /**
   * A picture of the contributor: an image `Blob` or `File` (JPEG, PNG or WebP, up to 5 MB) that
   * the SDK uploads, or a URL string that is stored as it is.
   */
  image?: Blob | string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

export const contributorInformationKind: RecordKind<ContributorInformationInput> = recordKind(
  contributorInformation.main,
  {
    identifier: optionalText,
    displayName: optionalText,
    image: optionalMedia,
  },
  { image: mediaTransform("image") },
);

/**
 * Creates a contributor-information record (`org.hypercerts.claim.contributorInformation`) in the
 * authenticated account's repo.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 * A `Blob` image is uploaded before the record is written; a URL string is stored as it is and
 * never fetched. An upload is not part of the write: if the write fails, the uploaded blob is
 * left unreferenced.
 *
 * Nothing is looked up or deduplicated: calling this twice for the same person creates two
 * records. To use a record that already exists, pass its URI as a contributor's `identity` to
 * {@link createActivity}. To name a contributor without a record, pass `{ inline: "<DID or name>" }`
 * there instead.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The contributor's data. See {@link ContributorInformationInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field or a value the lexicon does not
 * allow. Nothing was written. Blobs may already have been uploaded when a lexicon rule rejects the record.
 * @throws {@link Error} If the client is not authenticated, or the image upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not exist. It carries the URI to check; the SDK does not retry.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createContributorInformation } from "@hypercerts-org/sdk/activity";
 *
 * const alice = await createContributorInformation(context, {
 *   identifier: "did:plc:alice123",
 *   displayName: "Alice",
 * });
 * ```
 */
export const createContributorInformation: StandaloneCreator<ContributorInformationInput> = (
  context,
  input,
) => createStandalone(context, "createContributorInformation", contributorInformationKind, input);
