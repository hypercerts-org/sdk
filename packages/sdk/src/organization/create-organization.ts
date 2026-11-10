import { type CidString, l, type NsidString, type RecordKeyString } from "@atproto/lex";
import * as organization from "@hypercerts-org/lexicon/app/certified/actor/organization";
import * as profile from "@hypercerts-org/lexicon/app/certified/actor/profile";
import { type ProfileInput, profileKind } from "../actor/build-profile.js";
import type { SDKContext } from "../context.js";
import { type BuildContext, createBuildContext, parseInput } from "../internal/build-context.js";
import { describeError, isRecordNotFound } from "../internal/describe.js";
import { strictObject } from "../internal/input.js";
import { readRepoHead } from "../internal/read-repo-head.js";
import { readRecord, type StoredRecord, type StrongRef } from "../internal/resolve-record-ref.js";
import {
  flattenSlots,
  type NewSlot,
  newSlots,
  planNew,
  prepareNew,
  readBeforeWriting,
  recordRef,
  referencedResults,
  referenceLookup,
  type SupportingRecordRef,
} from "../internal/slots.js";
import {
  assertWithinWriteLimit,
  RecordAlreadyExistsError,
  submitWrites,
} from "../internal/submit-writes.js";
import { type OrganizationInput, organizationKind } from "./build-organization.js";

const OPERATION = "createOrganization";

// Why a repeat call after an unknown outcome cannot duplicate the new locations, which have
// generated keys: see `retrySafeReason`.
const RETRY_SAFE_REASON =
  "the call reads the organization first, so a repeat call either creates everything or fails because the organization already exists";

// Both lexicons fix their record key to `self`.
const SELF = "self" as RecordKeyString;

/** The input of {@link createOrganization}. */
export interface CreateOrganizationInput {
  /** The organization's own metadata. See {@link OrganizationInput}. */
  organization: OrganizationInput;
  /**
   * The data to create the account's profile from, used only if the account has no profile. An
   * existing profile is reused unchanged and this is ignored, apart from being validated: it is
   * never an update, and its `avatar` and `banner` are not uploaded. Required when the account has
   * no profile. See {@link ProfileInput}.
   */
  profileIfMissing?: ProfileInput | undefined;
}

/**
 * The result of {@link createOrganization}.
 *
 * @remarks
 * `location` and `additionalLocations` mirror the input: `additionalLocations[i]` belongs to the
 * input entry at the same index, whether it was created or reused. Filter on `created` for only the
 * records this call wrote.
 */
export interface CreateOrganizationResult {
  /** The URI and CID of the new organization record. */
  organization: StrongRef;
  /**
   * The account's profile. `created` is `true` when this call wrote it from `profileIfMissing`,
   * `false` when the account already had one, which is unchanged; its `cid` is then the one the SDK
   * read.
   */
  profile: SupportingRecordRef;
  /** The primary location, when the input had `location`. */
  location?: SupportingRecordRef;
  /** The additional locations, in input order, when the input had `additionalLocations`. */
  additionalLocations?: readonly SupportingRecordRef[];
  /**
   * The document the input's `longDescription` pointed at, with the CID that was stored. Present
   * only for a `{ uri }` description; `created` is `false`.
   */
  longDescription?: SupportingRecordRef;
}

/**
 * The account already has an organization record, so `createOrganization` did not write one.
 *
 * @remarks
 * Nothing was uploaded or written: the existing organization is untouched. `uri` is the existing
 * record and `attempted` is empty, because the SDK found the record before sending anything.
 * Extends {@link RecordAlreadyExistsError}, which extends {@link WriteRejectedError}, so code that
 * handles either also handles this; `status` is `400` and `code` is `InvalidSwap`, as the PDS
 * reports a taken key.
 */
export class OrganizationAlreadyExistsError extends RecordAlreadyExistsError {
  override readonly name = "OrganizationAlreadyExistsError";
}

const inputSchema = strictObject({
  organization: l.unknown(),
  profileIfMissing: l.optional(l.unknown()),
});

/**
 * Creates the account's organization record (`app.certified.actor.organization`), and its profile
 * if it has none, in one atomic write.
 *
 * @remarks
 * An account has at most one organization record and one profile, both at the key `self`. The SDK
 * reads both from the account's PDS before it uploads or writes anything:
 * - The account already has an organization: {@link OrganizationAlreadyExistsError}. Nothing is
 *   overwritten, merged or updated, and the SDK has no operation that updates an organization.
 * - The account has a profile: it is reused exactly as it is. `profileIfMissing` is not applied to
 *   it, and its `avatar` and `banner` are not uploaded.
 * - The account has no profile and `profileIfMissing` is set: the profile is created from it, in
 *   the same write.
 * - The account has no profile and `profileIfMissing` is not set: a {@link TypeError}. The SDK
 *   does not create an empty profile. An explicit `profileIfMissing: {}` is data, and creates one
 *   with only its `createdAt`.
 *
 * A read that fails for any reason other than "the record does not exist" (a network error, a
 * server error, a refused permission) throws; it is never taken as "absent".
 *
 * Each location (`location`, and each of `additionalLocations`) is the data of a new location or
 * `{ uri }` of an existing `app.certified.location` record, which is read to learn its CID and
 * reused unchanged. A bare URI string is not accepted. `longDescription` takes a string, a
 * {@link LeafletDocument} stored inline, or `{ uri }` of an existing record, which is referenced
 * and never created. Nothing is deduplicated: the primary location may repeat in
 * `additionalLocations`, and the SDK does not notice. `createdAt` defaults to the time of the call.
 *
 * The new profile (if any), the new locations and the organization are created in a single
 * `com.atproto.repo.applyWrites` request, which the PDS commits as a whole: all of them exist
 * afterwards, or none does. One write holds at most 200 records.
 *
 * Concurrent changes: the write is conditional on the account not having changed since the profile
 * and the organization were read, so another call creating either one in the meantime cannot make
 * the decision "reuse or create the profile" stale. If it did change, this throws
 * {@link WriteRejectedError} with `code` `"InvalidSwap"`; see there.
 *
 * The order is: validate the input, read the latest commit, read the profile and the organization,
 * read the existing records the input points at, upload blobs, write. An invalid input, an existing
 * organization, a missing profile without `profileIfMissing`, a read that fails, or too many records
 * stops before any upload. Blobs (a `Blob` or `File` logo, a new location's `{ blob }`, and the
 * profile's images when the profile is created) are uploaded before the write and are not rolled
 * back if it fails; see {@link uploadBlob}.
 *
 * The OAuth session needs `create` on `app.certified.actor.organization`, and on
 * `app.certified.actor.profile` and `app.certified.location` when this call creates them. Unlike
 * {@link createProfile}, no `update` permission is needed.
 *
 * This creates records in the repository the client is signed in to. It does not create accounts,
 * and has no connection to a group service.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The organization and the fallback profile. See {@link CreateOrganizationInput}.
 * @returns The organization's URI and CID, the profile's with whether it was created or reused,
 * and the locations. See {@link CreateOrganizationResult}.
 * @throws {@link TypeError} If `input` has an unknown field or a value the lexicons do not allow, a
 * location that is a bare string or a `{ uri }` of another record type, `{ uri }` combined with
 * record fields, more new records than one write holds, or the account has no profile and
 * `profileIfMissing` is not set. The message names the field. Nothing was written. Blobs may already
 * have been uploaded when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, the latest commit, the profile, the
 * organization or an existing record the input points at cannot be read, or an upload fails. Nothing
 * was written.
 * @throws {@link OrganizationAlreadyExistsError} If the account already has an organization.
 * Nothing was uploaded or written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). With `code`
 * `"InvalidSwap"` the repository changed after it was read; call again.
 * {@link OrganizationAlreadyExistsError} has the same `code` but is not retryable: rule out
 * `instanceof RecordAlreadyExistsError` first.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is safe even though new locations get fresh record keys: the call reads the organization first,
 * so it either creates everything or throws {@link OrganizationAlreadyExistsError}, which then
 * means the first attempt succeeded and no second set of locations or profile is created. The new
 * records are the ones in `attempted` of the first error.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example Creating an organization and, if the account has none, its profile
 * ```ts
 * import { createOrganization } from "@hypercerts-org/sdk/organization";
 *
 * // `context` comes from createSDKContext; `logoFile` is a File, for example from an
 * // <input type="file">.
 * const { organization, profile, location } = await createOrganization(context, {
 *   organization: {
 *     legalName: "Phobjikha Conservation Society",
 *     organizationType: ["ngo"],
 *     urls: [{ url: "https://example.org/donate", label: "Donate" }],
 *     logo: logoFile, // uploaded; a URL string would be stored as it is
 *     longDescription: "We plant native trees in the Phobjikha valley.",
 *     location: {
 *       lpVersion: "1.0",
 *       srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *       locationType: "country-code",
 *       location: { string: "BT" },
 *     }, // created
 *     additionalLocations: [
 *       { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // reused
 *     ],
 *   },
 *   // Used only if the account has no profile yet; ignored (and its images not uploaded) otherwise.
 *   profileIfMissing: { displayName: "Phobjikha Conservation", avatar: "https://example.org/a.png" },
 * });
 * console.log(organization.uri); // at://<did>/app.certified.actor.organization/self
 * console.log(profile.created); // false when the account already had a profile
 * ```
 *
 * @example An organization already exists
 * ```ts
 * import { createOrganization, OrganizationAlreadyExistsError } from "@hypercerts-org/sdk/organization";
 *
 * try {
 *   await createOrganization(context, { organization: { legalName: "Acme" } });
 * } catch (error) {
 *   if (!(error instanceof OrganizationAlreadyExistsError)) throw error;
 *   // Nothing was uploaded or written, and the SDK cannot update the existing organization.
 *   console.log(error.uri);
 * }
 * ```
 *
 * @example A missing profile needs `profileIfMissing`
 * ```ts
 * import { createOrganization } from "@hypercerts-org/sdk/organization";
 *
 * // TypeError if the account has no profile: the SDK does not create an empty one.
 * await createOrganization(context, { organization: { legalName: "Acme" } });
 * ```
 *
 * @example Reusing an existing location takes `{ uri }`, not a string
 * ```ts
 * import { createOrganization } from "@hypercerts-org/sdk/organization";
 *
 * await createOrganization(context, {
 *   organization: {
 *     location: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8", // TypeError
 *   },
 *   profileIfMissing: { displayName: "Acme" },
 * });
 * ```
 *
 * @example Calling again when the repository changed in between
 * ```ts
 * import {
 *   createOrganization,
 *   RecordAlreadyExistsError,
 *   WriteRejectedError,
 * } from "@hypercerts-org/sdk/organization";
 *
 * try {
 *   return await createOrganization(context, input);
 * } catch (error) {
 *   if (
 *     error instanceof WriteRejectedError &&
 *     error.code === "InvalidSwap" &&
 *     // OrganizationAlreadyExistsError has the same code, but calling again cannot fix it.
 *     !(error instanceof RecordAlreadyExistsError)
 *   ) {
 *     // Another write to the account landed between the reads and the write. Nothing was written,
 *     // so it is safe to call again; everything is read afresh.
 *     return await createOrganization(context, input);
 *   }
 *   throw error;
 * }
 * ```
 */
export async function createOrganization(
  context: SDKContext,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const build = createBuildContext(context, OPERATION);
  const { organization: organizationSlot, fallback } = planInput(build, input);

  const start = await readStartingPoint(build);
  if (start.organization !== undefined) throw organizationExists(start.organization.ref.uri);
  const profilePlan = planProfile(build, start.profile, fallback);

  // A reused profile is not in the write, so its images are never uploaded.
  const slots = flattenSlots(
    profilePlan.kind === "created" ? [profilePlan.slot, organizationSlot] : [organizationSlot],
  );
  assertWithinWriteLimit(OPERATION, newSlots(slots).length);
  const existing = await readBeforeWriting(build, slots, { checkKeys: false });
  const created = await prepareNew(slots, existing);

  // The organization has a fixed key and was found absent above, so calling again after an unknown
  // outcome creates everything or finds the organization, and never makes a copy.
  await submitWrites(context, build.did, [...created.values()], OPERATION, {
    swapCommit: start.head,
    retrySafe: true,
    retrySafeReason: RETRY_SAFE_REASON,
  });

  const refOf = referenceLookup(existing, created);
  return {
    organization: refOf(organizationSlot),
    profile:
      profilePlan.kind === "created"
        ? recordRef(profilePlan.slot, created, refOf)
        : { ...profilePlan.ref, created: false },
    ...referencedResults(organizationSlot, created, refOf),
  };
}

// Validates everything the caller passed before any request is sent, the fallback profile included
// even when it ends up unused, so an input error does not depend on the account's state.
function planInput(
  build: BuildContext,
  input: unknown,
): { organization: NewSlot; fallback: NewSlot | undefined } {
  const parsed = parseInput(build, "input", inputSchema, input);
  return {
    organization: planNew(build, "organization", organizationKind, parsed.organization),
    fallback:
      parsed.profileIfMissing === undefined
        ? undefined
        : planNew(build, "profileIfMissing", profileKind, parsed.profileIfMissing),
  };
}

interface StartingPoint {
  head: CidString;
  profile: StoredRecord | undefined;
  organization: StoredRecord | undefined;
}

// What the write is based on. The head is read first, so a change to either record after it moves
// the head past the one the write is conditional on: see `readRepoHead`.
async function readStartingPoint(build: BuildContext): Promise<StartingPoint> {
  const head = await readRepoHead(build.context, build.did, OPERATION);
  const [profileRecord, organizationRecord] = await Promise.all([
    readSingleton(build, profile.main.$type),
    readSingleton(build, organization.main.$type),
  ]);
  return { head, profile: profileRecord, organization: organizationRecord };
}

type ProfilePlan = { kind: "reused"; ref: StrongRef } | { kind: "created"; slot: NewSlot };

// Reuse the profile the account has, or create it from the fallback.
function planProfile(
  build: BuildContext,
  existingProfile: StoredRecord | undefined,
  fallback: NewSlot | undefined,
): ProfilePlan {
  if (existingProfile !== undefined) return { kind: "reused", ref: existingProfile.ref };
  if (fallback === undefined) throw missingProfile(singletonUri(build, profile.main.$type));
  return { kind: "created", slot: fallback };
}

const singletonUri = (build: BuildContext, collection: NsidString) =>
  `at://${build.did}/${collection}/${SELF}`;

// The record at `self`, or `undefined` when the PDS says there is none. Any other failure throws: a
// record that could not be read is not a record that is absent.
async function readSingleton(
  build: BuildContext,
  collection: NsidString,
): Promise<StoredRecord | undefined> {
  const uri = singletonUri(build, collection);
  try {
    return await readRecord(build.context, uri, OPERATION);
  } catch (error) {
    // `readRecord` keeps the client's error as the cause of its own.
    const cause = error instanceof Error ? error.cause : undefined;
    if (isRecordNotFound(cause)) return undefined;
    throw new Error(
      `${OPERATION}: cannot check whether ${uri} exists (${describeError(cause ?? error)}), so nothing was uploaded or written.`,
      { cause: error },
    );
  }
}

function organizationExists(uri: string): OrganizationAlreadyExistsError {
  return new OrganizationAlreadyExistsError(
    `${OPERATION}: the account already has an organization (${uri}), so nothing was uploaded or written and the existing one is unchanged. ${OPERATION} only creates an organization; it never overwrites one, and the SDK cannot update an organization yet.`,
    uri,
    [],
    { status: 400, code: "InvalidSwap" },
  );
}

function missingProfile(uri: string): TypeError {
  return new TypeError(
    `${OPERATION}: the account has no profile (${uri} does not exist) and the input has no profileIfMissing to create one from, so nothing was uploaded or written. Pass profileIfMissing with the profile's data (for example { displayName: "Acme" }), or create the profile first with createProfile.`,
  );
}
