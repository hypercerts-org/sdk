import * as contribution from "@hypercerts-org/lexicon/org/hypercerts/claim/contribution";
import { createStandalone, type StandaloneCreator } from "../internal/create-record.js";
import { dateRange, optionalText } from "../internal/input.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";

/** The data of a new `org.hypercerts.claim.contribution` record. */
export interface ContributionInput {
  /** The contributor's role or title. At most 100 characters. */
  role?: string | undefined;
  /** What the contribution concretely involved. At most 1000 characters. */
  contributionDescription?: string | undefined;
  /** An ISO 8601 date-time. Should fall within the Activity's timeframe; this is not checked. */
  startDate?: string | undefined;
  /** An ISO 8601 date-time, not before `startDate`. */
  endDate?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

export const contributionKind: RecordKind<ContributionInput> = recordKind(
  contribution.main,
  {
    role: optionalText,
    contributionDescription: optionalText,
    startDate: optionalText,
    endDate: optionalText,
  },
  {},
  { refinements: [dateRange] },
);

/**
 * Creates a contribution record (`org.hypercerts.claim.contribution`), the details of one
 * contributor's work, in the authenticated account's repo.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 * The dates are not compared with any Activity's timeframe.
 *
 * Nothing is looked up or deduplicated: calling this twice creates two records. To use a record
 * that already exists, pass its URI as a contributor's `details` to {@link createActivity}. For a
 * role that needs no record of its own, pass `{ inline: "<role>" }` there instead.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The contribution's data. See {@link ContributionInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, an `endDate` before its `startDate`,
 * or a value the lexicon does not allow. Nothing was written.
 * @throws {@link Error} If the client is not authenticated.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createContribution } from "@hypercerts-org/sdk/activity";
 *
 * const details = await createContribution(context, {
 *   role: "Field coordinator",
 *   contributionDescription: "Organised the planting days.",
 *   startDate: "2024-03-01T00:00:00Z",
 *   endDate: "2024-06-30T00:00:00Z",
 * });
 * ```
 */
export const createContribution: StandaloneCreator<ContributionInput> = (context, input) =>
  createStandalone(context, "createContribution", contributionKind, input);
