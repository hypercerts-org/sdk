import { type DatetimeString, type DidString, l } from "@atproto/lex";
import * as award from "@hypercerts-org/lexicon/app/certified/badge/award";
import * as response from "@hypercerts-org/lexicon/app/certified/badge/response";
import * as certifiedDefs from "@hypercerts-org/lexicon/app/certified/defs";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import type { SDKContext } from "../context.js";
import { createBuildContext, parseInput, prepareChecked } from "../internal/build-context.js";
import { describeError } from "../internal/describe.js";
import { compact, optionalText, strictObject, weightString } from "../internal/input.js";
import { parseRecordUri, readRecord, type StrongRef } from "../internal/resolve-record-ref.js";
import { submitWrites } from "../internal/submit-writes.js";

const OPERATION = "respondToBadgeAward";

/** The input of {@link respondToBadgeAward}. */
export interface RespondToBadgeAwardInput {
  /**
   * The award to respond to, as `at://<did>/app.certified.badge.award/<rkey>`, identified by a DID,
   * not a handle. It may be in any account's repository if it is public.
   */
  awardUri: string;
  /** Whether the recipient accepts or rejects the award. */
  response: "accepted" | "rejected";
  /**
   * How much the recipient weighs this badge, a positive decimal number written as a string (for
   * example `"2"` or `"0.5"`), only for an accepted award. It is stored exactly as written. At most
   * 50 characters.
   */
  weight?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

const inputSchema = l.refine(
  strictObject({
    awardUri: l.string(),
    response: l.enum(["accepted", "rejected"]),
    weight: l.optional(weightString),
    createdAt: optionalText,
  }),
  {
    check: ({ response: answer, weight }) => !(answer === "rejected" && weight !== undefined),
    message: 'has a weight on a rejected award; a weight applies only when response is "accepted"',
    path: "weight",
  },
);

// Checked before any request: the URI must name a badge award.
function assertAwardUri(uri: string): void {
  const { collection } = parseRecordUri(uri, OPERATION);
  if (collection !== award.main.$type) {
    throw new TypeError(
      `${OPERATION}: awardUri points at a record of type ${collection}, but it must be of type ${award.main.$type}: ${uri}. Expected at://<did>/${award.main.$type}/<rkey>.`,
    );
  }
}

// The account the award is for: the DID of an account subject, or the repository that holds a
// record subject. That a record's repository is its recipient is the SDK's rule; the lexicon only
// says responses are written by the recipient.
function recipientOf({ subject }: award.Main, uri: string): DidString {
  if (certifiedDefs.did.isTypeOf(subject)) return subject.did as DidString;
  if (!strongRef.main.isTypeOf(subject)) {
    throw new Error(
      `${OPERATION}: the award ${uri} is for something that is neither an account (${certifiedDefs.did.$type}) nor a record (${strongRef.main.$type}), so the SDK cannot tell who its recipient is. No record was written.`,
    );
  }
  try {
    return parseRecordUri(subject.uri, OPERATION).did;
  } catch (error) {
    throw new Error(
      `${OPERATION}: the award ${uri} is for ${subject.uri}, which does not name its repository by DID, so the SDK cannot tell who its recipient is. No record was written.`,
      { cause: error },
    );
  }
}

/**
 * Accepts or rejects a badge award (`app.certified.badge.response`) as its recipient.
 *
 * @remarks
 * The award is read from its repository and the response is created in the signed-in account's
 * repo. The recipient of an award to an account is that account; the recipient of an award to a
 * record is the account whose repository holds the record. The lexicon says only that a response
 * comes from the recipient, so that second rule is this SDK's: only the recipient's own response is
 * created. Awarding a badge does not accept it for the recipient, so an issuer cannot respond to
 * their own award unless they are also the recipient.
 *
 * The response references the award by URI and the CID that was read. The award, the badge
 * definition and the subject are not changed. `weight` is for an accepted award only and is stored
 * exactly as given: `"007.50"` stays `"007.50"`. It must be a positive decimal number, as elsewhere
 * in the SDK. `createdAt` defaults to the time of the call.
 *
 * Nothing is deduplicated or overwritten: every call creates a response under a new record key, so
 * responding twice, even with a different answer, leaves two responses. The SDK has no operation
 * that changes or removes one, and does not check for an earlier response; how to read several
 * responses to one award is up to the consumer.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated as the recipient.
 * @param input - The award, the answer and an optional weight. See {@link RespondToBadgeAwardInput}.
 * @returns The new response's URI and CID.
 * @throws {@link TypeError} If `awardUri` is not `at://<did>/app.certified.badge.award/<rkey>`, if
 * `response` is not `"accepted"` or `"rejected"`, if `weight` is given with a rejected response or
 * is not a positive decimal number, if `input` has an unknown field, or if a value is not allowed
 * by the lexicon (for example a `weight` over 50 characters). Nothing was written.
 * @throws {@link Error} If the client is not authenticated; the award cannot be read or is not a
 * valid `app.certified.badge.award`; its recipient cannot be determined; or the signed-in account is
 * not the recipient. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create a second response if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example Accepting an award with a weight
 * ```ts
 * import { respondToBadgeAward } from "@hypercerts-org/sdk/badge";
 *
 * // `context` comes from createSDKContext, signed in as the award's recipient.
 * const response = await respondToBadgeAward(context, {
 *   awardUri: "at://did:plc:issuer/app.certified.badge.award/3k2a4b5c6d7e8",
 *   response: "accepted",
 *   weight: "2",
 * });
 * console.log(response.uri, response.cid);
 * ```
 *
 * @example Rejecting an award
 * ```ts
 * import { respondToBadgeAward } from "@hypercerts-org/sdk/badge";
 *
 * await respondToBadgeAward(context, {
 *   awardUri: "at://did:plc:issuer/app.certified.badge.award/3k2a4b5c6d7e8",
 *   response: "rejected", // a weight here throws a TypeError
 * });
 * ```
 */
export async function respondToBadgeAward(
  context: SDKContext,
  input: RespondToBadgeAwardInput,
): Promise<StrongRef> {
  const build = createBuildContext(context, OPERATION);
  const parsed = parseInput(build, "input", inputSchema, input);
  assertAwardUri(parsed.awardUri);

  const stored = await readRecord(context, parsed.awardUri, OPERATION);
  const checked = award.main.safeValidate(stored.value);
  if (!checked.success) {
    throw new Error(
      `${OPERATION}: ${parsed.awardUri} is not a valid ${award.main.$type} record (${describeError(checked.reason)}), so the SDK does not respond to it. No record was written.`,
      { cause: checked.reason },
    );
  }
  const recipient = recipientOf(checked.value, parsed.awardUri);
  if (recipient !== build.did) {
    throw new Error(
      `${OPERATION}: only the recipient can respond to a badge award, but ${parsed.awardUri} is for ${recipient} and the client is signed in as ${build.did}. No record was written. For an award to a record, the recipient is the account whose repository holds that record.`,
    );
  }

  const record = await prepareChecked(
    build,
    "the response",
    response.main,
    compact({
      badgeAward: stored.ref,
      response: parsed.response,
      weight: parsed.weight,
      createdAt: (parsed.createdAt ?? build.createdAt) as DatetimeString,
    }),
  );
  await submitWrites(context, build.did, [record], OPERATION);
  return record.ref;
}
