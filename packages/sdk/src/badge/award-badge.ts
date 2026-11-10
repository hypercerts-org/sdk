import { type DatetimeString, l, type UriString } from "@atproto/lex";
import * as award from "@hypercerts-org/lexicon/app/certified/badge/award";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  parseInput,
  prepareChecked,
} from "../internal/build-context.js";
import { compact, endsBeforeStart, optionalText, strictObject } from "../internal/input.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
import { submitWrites } from "../internal/submit-writes.js";
import {
  parseSubject,
  planDefinition,
  resolveDefinition,
  resolveSubject,
} from "./award-targets.js";
import type { BadgeDefinitionInput } from "./build-definition.js";

const OPERATION = "awardBadge";

/** What a badge is awarded to: an account, or any record. */
export type AwardSubject =
  | {
      /** The DID of the account. */
      did: string;
    }
  | {
      /**
       * The record, as `at://<did>/<collection>/<rkey>`, identified by a DID, not a handle. It may
       * be of any type and in any account's repository if it is public.
       */
      uri: string;
    };

/** The input of {@link awardBadge}. */
export interface AwardBadgeInput {
  /**
   * The badge to award: the data of a new definition, which is created in the same commit, or
   * `{ uri }` of an existing `app.certified.badge.definition`, which is read and reused as it is.
   * See {@link BadgeDefinitionInput}.
   */
  definition: BadgeDefinitionInput | ExistingRecord;
  /** What the badge is awarded to: `{ did }` for an account, `{ uri }` for a record. */
  subject: AwardSubject;
  /** Why the badge is awarded. At most 500 characters. */
  note?: string | undefined;
  /** A URL the award links to. */
  url?: string | undefined;
  /**
   * An ISO 8601 date-time: when the badge starts to apply, which may differ from when the award is
   * written. Left out: it applies from `createdAt`.
   */
  validFrom?: string | undefined;
  /**
   * An ISO 8601 date-time, not before `validFrom` (or `createdAt` when `validFrom` is left out):
   * when the badge stops applying. Left out: no end. After it the award is expired, not revoked.
   */
  validUntil?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/** The result of {@link awardBadge}. */
export interface AwardBadgeResult {
  /** The new award's URI and CID. */
  award: StrongRef;
  /**
   * The badge definition the award references, with the CID of the version that was checked.
   * `created` is `true` when this call created it, `false` when it reused an existing one.
   */
  definition: SupportingRecordRef;
}

const awardInput = strictObject({
  definition: l.unknown(),
  subject: l.unknown(),
  note: optionalText,
  url: optionalText,
  validFrom: optionalText,
  validUntil: optionalText,
  createdAt: optionalText,
});

// The effective start is the one the lexicon documents: `validFrom`, else `createdAt` (which, left
// out, is the time of the call). A date that does not parse is not judged here: the lexicon
// rejects it when the award is validated.
function assertValidityRange(
  build: BuildContext,
  { validFrom, validUntil, createdAt }: l.InferOutput<typeof awardInput>,
): void {
  const start = validFrom ?? createdAt ?? build.createdAt;
  if (!endsBeforeStart({ startDate: start, endDate: validUntil })) return;
  const startsAt =
    validFrom === undefined
      ? `createdAt (${start}), which is when the badge starts to apply because validFrom is left out${createdAt === undefined ? " and createdAt defaults to the time of the call" : ""}`
      : `validFrom (${start})`;
  throw new TypeError(
    `${build.operation}: validUntil (${validUntil}) is earlier than ${startsAt}, so the badge would end before it starts. Nothing was written.`,
  );
}

/**
 * Awards a badge (`app.certified.badge.award`) to an account or a record, creating the badge's
 * definition in the same commit when it is new.
 *
 * @remarks
 * `definition` is either the data of a new definition (see {@link createBadgeDefinition}) or
 * `{ uri }` of an existing one. A new definition and the award go into a single
 * `com.atproto.repo.applyWrites` request, which the PDS commits as a whole: both exist afterwards,
 * or neither does. An existing definition is read and reused as it is; the award pins the version
 * that was read by its CID.
 *
 * `subject` is `{ did }` for an account, stored as the lexicon's DID object, or `{ uri }` for any
 * record, of any type and in any account's repository, stored as a strong reference to the record
 * as it is now. The record is read, never changed.
 *
 * Who may award: the signed-in account's DID must be in the definition's `allowedIssuers`. Left out,
 * anyone may award the badge; an empty array means no one may. The check is made against the
 * definition version the award references, so a later change of the list does not affect an award
 * that was already made. It is made by the SDK from what it read, not by the PDS. A refused award
 * writes nothing and uploads nothing.
 *
 * `createdAt` defaults to the time of the call and `validFrom` to `createdAt`. A `validUntil` earlier
 * than `validFrom` (or, without `validFrom`, than `createdAt`) is refused. `validUntil` marks the
 * award as expired from then on; it does not revoke anything, and the SDK has no operation that
 * revokes or changes an award. The recipient accepts or rejects the award with
 * {@link respondToBadgeAward}; awarding does not do it for them.
 *
 * Nothing is deduplicated: awarding the same badge to the same subject twice creates two awards.
 * The order is: validate the input, read the subject record, read an existing definition or upload
 * a new definition's icon, validate the records against their lexicons, write. Invalid input, a
 * refused issuer and an unreadable subject or definition stop before any upload. A rule of the
 * award's or the new definition's lexicon (for example a `note` over 500 characters) is only found
 * after the icon is uploaded. If the PDS rejects the write, or a lexicon rule does, the uploaded icon
 * stays unreferenced; see {@link createBadgeDefinition}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the award, and a new definition, are created in that account's repo.
 * @param input - The badge, the subject and the optional note, link and validity. See
 * {@link AwardBadgeInput}.
 * @returns The award's URI and CID, and the definition's, with whether this call created it. See
 * {@link AwardBadgeResult}.
 * @throws {@link TypeError} If `input` has an unknown field; `subject` is neither `{ did }` nor
 * `{ uri }` of a record; `definition` mixes `{ uri }` with other fields, points at another type of
 * record, or is invalid as a new definition; `validUntil` is before its start; or a value is not
 * allowed by the lexicons. Nothing was written. An icon may already have been uploaded when a
 * lexicon rule rejects the award or the new definition.
 * @throws {@link Error} If the client is not authenticated; the signed-in account is not allowed to
 * award the badge; the subject or the existing definition cannot be read, or the definition is not a
 * valid `app.certified.badge.definition`; or the icon upload fails. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the award
 * and a new definition may or may not exist. It lists their URIs, the definition first. The SDK does
 * not retry, because a retry would create a second award if the first attempt had succeeded. Check
 * the URIs, then decide.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed, so the award's reference to the definition may not match what is stored.
 *
 * @example Awarding an existing badge to an account
 * ```ts
 * import { awardBadge } from "@hypercerts-org/sdk/badge";
 *
 * // `context` comes from createSDKContext.
 * const { award, definition } = await awardBadge(context, {
 *   definition: { uri: "at://did:plc:abc123/app.certified.badge.definition/3k2a4b5c6d7e8" },
 *   subject: { did: "did:plc:xyz789" },
 *   note: "Completed the stewardship course.",
 *   validUntil: "2027-06-01T00:00:00.000Z",
 * });
 * console.log(award.uri, definition.created); // definition.created is false
 * ```
 *
 * @example Defining a new badge and awarding it to a record in one commit
 * ```ts
 * import { awardBadge } from "@hypercerts-org/sdk/badge";
 *
 * const { award, definition } = await awardBadge(context, {
 *   definition: { title: "Field verified", badgeType: "verification" }, // created too
 *   subject: { uri: "at://did:plc:xyz789/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 * });
 * console.log(definition.created, award.uri); // true
 * ```
 */
export async function awardBadge(
  context: SDKContext,
  input: AwardBadgeInput,
): Promise<AwardBadgeResult> {
  const build = createBuildContext(context, OPERATION);
  const parsed = parseInput(build, "input", awardInput, input);
  assertValidityRange(build, parsed);
  const subject = parseSubject(build, parsed.subject);
  const plan = planDefinition(build, parsed.definition);

  // The subject is read before the definition's icon is uploaded, so an unreadable subject fails first.
  const subjectValue = await resolveSubject(build, subject);
  const badge = await resolveDefinition(build, plan);
  const record = await prepareChecked(
    build,
    "the award",
    award.main,
    compact({
      badge: badge.ref,
      subject: subjectValue,
      note: parsed.note,
      url: parsed.url as UriString | undefined,
      validFrom: parsed.validFrom as DatetimeString | undefined,
      validUntil: parsed.validUntil as DatetimeString | undefined,
      createdAt: (parsed.createdAt ?? build.createdAt) as DatetimeString,
    }),
  );

  const writes = badge.created === undefined ? [record] : [badge.created, record];
  await submitWrites(context, build.did, writes, OPERATION);
  return {
    award: record.ref,
    definition: { ...badge.ref, created: badge.created !== undefined },
  };
}
