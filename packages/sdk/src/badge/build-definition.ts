import { type DidString, l } from "@atproto/lex";
import * as definition from "@hypercerts-org/lexicon/app/certified/badge/definition";
import * as certifiedDefs from "@hypercerts-org/lexicon/app/certified/defs";
import type { BuildContext } from "../internal/build-context.js";
import { createStandalone, type StandaloneCreator } from "../internal/create-record.js";
import { blob, optionalText } from "../internal/input.js";
import { assertFileAllowed, uploadField } from "../internal/media.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";

/** The data of a new `app.certified.badge.definition` record. */
export interface BadgeDefinitionInput {
  /** The badge's display title. At most 256 characters. */
  title: string;
  /**
   * The category of the badge, for example `endorsement`, `verification`, `participation`,
   * `certification`, `affiliation` or `recognition`. Any other value is accepted. At most 100
   * characters.
   */
  badgeType: string;
  /** A short statement of what the badge represents. At most 500 graphemes. */
  description?: string | undefined;
  /**
   * The badge's icon: a PNG, JPEG, WebP or SVG `Blob` or `File` of at most 1 MiB that the SDK
   * uploads. A URL is not accepted: the lexicon stores only an uploaded file.
   */
  icon?: Blob | undefined;
  /**
   * The accounts allowed to award the badge, as DIDs, at most 100. Left out: anyone may award it.
   * An empty array: no one may. {@link awardBadge} checks the signed-in account against this list.
   */
  allowedIssuers?: readonly string[] | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

// `icon` is a blob field of the definition itself, not a wrapper object like the images of the
// other records, so `mediaValue` does not apply and the reference is stored as it is. The lexicon
// decides which types and sizes an icon may have, so the check runs the definition's own schema.
async function uploadIcon(build: BuildContext, field: string, file: Blob) {
  assertFileAllowed(build, field, file, "used as a badge icon", (icon) =>
    definition.main.safeValidate({
      $type: definition.main.$type,
      title: "icon check",
      badgeType: "icon check",
      createdAt: build.createdAt,
      icon,
    }),
  );
  return uploadField(build, field, file);
}

export const badgeDefinitionKind: RecordKind<BadgeDefinitionInput> = recordKind(
  definition.main,
  {
    title: l.string(),
    badgeType: l.string(),
    description: optionalText,
    icon: l.optional(blob),
    allowedIssuers: l.optional(l.array(l.string({ format: "did" }))),
  },
  {
    icon: uploadIcon,
    allowedIssuers: (_build, _field, dids: DidString[]) =>
      Promise.resolve(dids.map((did) => certifiedDefs.did.build({ did }))),
  },
);

/**
 * Creates a badge definition (`app.certified.badge.definition`) in the authenticated account's repo.
 *
 * @remarks
 * A definition says what a badge is and who may award it; {@link awardBadge} then awards it to an
 * account or a record. The record key is a new TID chosen by the SDK, and `createdAt` defaults to
 * the time of the call. Nothing is deduplicated: calling this twice creates two definitions.
 *
 * `allowedIssuers` takes plain DIDs. The SDK stores them as the lexicon's DID objects and does not
 * check that the accounts exist. Left out, anyone may award the badge; an empty array means no one
 * may. The signed-in account does not have to be on the list to create the definition, only to
 * award it.
 *
 * `badgeType` is free text; values outside the lexicon's known set (`endorsement`, `verification`,
 * `participation`, `certification`, `affiliation`, `recognition`) are accepted.
 *
 * `icon` is uploaded before the record is written. The SDK checks its type and size against the
 * lexicon (PNG, JPEG, WebP or SVG, at most 1 MiB) first, so a file the record would reject is not
 * uploaded. The upload is not part of the write: if the write fails, the uploaded blob is left
 * unreferenced. A PDS usually deletes unreferenced blobs after a while, but this is not guaranteed,
 * and a blob with the same content that another record already uses stays.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The definition's data. See {@link BadgeDefinitionInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, an `allowedIssuers` entry that is not
 * a DID, an `icon` that is not a PNG, JPEG, WebP or SVG of at most 1 MiB, or a value the lexicon
 * does not allow (for example a `title` over 256 characters). Nothing was written. Blobs may
 * already have been uploaded when a lexicon rule other than the icon's rejects the record.
 * @throws {@link Error} If the client is not authenticated, or the icon upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * definition may or may not exist. It carries the URI to check. The SDK does not retry, because
 * calling again would create a second definition if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createBadgeDefinition } from "@hypercerts-org/sdk/badge";
 *
 * // `context` comes from createSDKContext; `iconFile` is a File, for example from an
 * // <input type="file">.
 * const definition = await createBadgeDefinition(context, {
 *   title: "Verified steward",
 *   badgeType: "verification",
 *   description: "Confirmed to manage the land they report on.",
 *   icon: iconFile,
 *   allowedIssuers: ["did:plc:abc123"],
 * });
 * console.log(definition.uri, definition.cid);
 * ```
 *
 * @example Who may award the badge
 * ```ts
 * import { createBadgeDefinition } from "@hypercerts-org/sdk/badge";
 *
 * await createBadgeDefinition(context, { title: "Supporter", badgeType: "recognition" }); // anyone
 * await createBadgeDefinition(context, {
 *   title: "Retired",
 *   badgeType: "recognition",
 *   allowedIssuers: [], // no one: the badge can be defined but never awarded
 * });
 * ```
 */
export const createBadgeDefinition: StandaloneCreator<BadgeDefinitionInput> = (context, input) =>
  createStandalone(context, "createBadgeDefinition", badgeDefinitionKind, input);
