import { l } from "@atproto/lex";
import * as profile from "@hypercerts-org/lexicon/app/certified/actor/profile";
import type { SDKContext } from "../context.js";
import { optionalMedia, optionalText } from "../internal/input.js";
import { mediaTransform } from "../internal/media.js";
import { createStandalone, type RecordKind, recordKind } from "../internal/record-kind.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import { WriteRejectedError } from "../internal/submit-writes.js";

/** The data of the `app.certified.actor.profile` record of an account. */
export interface ProfileInput {
  /** The name to show for the account. At most 64 graphemes. */
  displayName?: string | undefined;
  /** Free-form text about the account. At most 256 graphemes. */
  description?: string | undefined;
  /** Free-form pronouns. At most 20 graphemes. */
  pronouns?: string | undefined;
  /**
   * The languages of the profile's text, as BCP-47 language tags such as `en` or `pt-BR`. At most
   * three.
   */
  langs?: readonly string[] | undefined;
  /** The account's website, as a URL. */
  website?: string | undefined;
  /**
   * The picture shown next to the account's name (an organization should use its brandmark): an
   * image `Blob` or `File` (JPEG, PNG or WebP, up to 5 MB) that the SDK uploads, or a URL string
   * that is stored as it is.
   */
  avatar?: Blob | string | undefined;
  /**
   * The wide image shown behind the profile: an image `Blob` or `File` (JPEG, PNG or WebP, up to
   * 10 MB) that the SDK uploads, or a URL string that is stored as it is.
   */
  banner?: Blob | string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

const profileKind: RecordKind<ProfileInput> = recordKind(
  profile.main,
  {
    displayName: optionalText,
    description: optionalText,
    pronouns: optionalText,
    langs: l.optional(l.array(l.string())),
    website: optionalText,
    avatar: optionalMedia,
    banner: optionalMedia,
  },
  { avatar: mediaTransform("image"), banner: mediaTransform("largeImage") },
);

/**
 * The account already has a profile record, so `createProfile` did not write one.
 *
 * @remarks
 * Nothing was changed: the existing profile is untouched. `attempted` holds the URI and CID the
 * new profile would have had. Extends {@link WriteRejectedError}, so code that handles any
 * rejected write also handles this; `status` is `400` and `code` is `InvalidSwap`, as the PDS
 * reported them.
 */
export class ProfileAlreadyExistsError extends WriteRejectedError {
  override readonly name = "ProfileAlreadyExistsError";
}

/**
 * Creates the account's profile record (`app.certified.actor.profile`) if it does not have one.
 *
 * @remarks
 * A profile is the single record at the key `self` in the authenticated account's repo. This
 * function only creates: it never overwrites or merges into an existing profile, and the SDK has
 * no operation that updates one. It writes with `com.atproto.repo.putRecord` and `swapRecord:
 * null`, the protocol's "only if no record is there yet", which the PDS checks as part of the
 * write. So two simultaneous calls cannot overwrite each other: one creates the profile and the
 * other throws {@link ProfileAlreadyExistsError}. This was verified against the reference PDS
 * only; another implementation that ignores `swapRecord: null` would overwrite.
 *
 * Because it uses `putRecord`, an OAuth session needs both the `create` and the `update`
 * permission on `app.certified.actor.profile` (for example the scope
 * `repo:app.certified.actor.profile?action=create&action=update`): the PDS checks both for a
 * `putRecord`, even though this function never overwrites. With only `create` the PDS answers
 * HTTP 403 and this function throws {@link WriteRejectedError}.
 *
 * `createdAt` defaults to the time of the call. A `Blob` avatar or banner is uploaded before the
 * record is written; a URL string is stored as it is and never fetched. An upload is not part of
 * the write: if the write fails, including when the profile already exists, this call leaves the
 * uploaded blob unreferenced. A PDS usually deletes unreferenced blobs after a while, but this is
 * not guaranteed, and a blob with the same content that another record already uses stays.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The profile's data. See {@link ProfileInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, or a value the lexicon does not
 * allow, for example more than three `langs` or an avatar that is not a JPEG, PNG or WebP image.
 * Nothing was written. Blobs may already have been uploaded when a lexicon rule rejects the
 * record.
 * @throws {@link Error} If the client is not authenticated, or an image upload fails.
 * @throws {@link ProfileAlreadyExistsError} If the account already has a profile. Nothing was
 * changed.
 * @throws {@link WriteRejectedError} If the PDS rejected the write for another reason (HTTP 4xx).
 * Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the
 * profile may or may not exist. It carries the URI to check; the SDK does not retry, but calling
 * again is safe: the profile is only created if absent, so the call either creates it or throws
 * {@link ProfileAlreadyExistsError}, which then means the profile exists, most likely from the
 * first attempt.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createProfile } from "@hypercerts-org/sdk/actor";
 *
 * // `context` comes from createSDKContext; `avatarFile` is a File, for example from an
 * // <input type="file">.
 * const profile = await createProfile(context, {
 *   displayName: "Alice",
 *   description: "Planting trees in the Phobjikha valley.",
 *   langs: ["en"],
 *   avatar: avatarFile, // uploaded; a URL string would be stored as it is
 *   banner: "https://example.org/banner.png",
 * });
 * console.log(profile.uri); // at://<did>/app.certified.actor.profile/self
 * ```
 *
 * @example Calling it twice does not update the profile
 * ```ts
 * import { createProfile, ProfileAlreadyExistsError } from "@hypercerts-org/sdk/actor";
 *
 * try {
 *   await createProfile(context, { displayName: "Alice" });
 *   await createProfile(context, { displayName: "Alice B." }); // the first call created it
 * } catch (error) {
 *   if (!(error instanceof ProfileAlreadyExistsError)) throw error;
 *   // The profile still says "Alice". The SDK cannot update it yet.
 * }
 * ```
 */
export async function createProfile(context: SDKContext, input: ProfileInput): Promise<StrongRef> {
  try {
    return await createStandalone(context, "createProfile", profileKind, input);
  } catch (error) {
    throw error instanceof WriteRejectedError && error.code === "InvalidSwap"
      ? alreadyExists(error)
      : error;
  }
}

function alreadyExists(rejected: WriteRejectedError): ProfileAlreadyExistsError {
  const [ref] = rejected.attempted;
  return new ProfileAlreadyExistsError(
    `createProfile: the account already has a profile, so nothing was written and the existing one is unchanged${ref ? ` (${ref.uri})` : ""}. createProfile only creates a profile; it never overwrites one, and the SDK cannot update a profile yet.`,
    rejected.attempted,
    { status: rejected.status, code: rejected.code },
    { cause: rejected.cause },
  );
}
