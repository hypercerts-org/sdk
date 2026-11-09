import { l } from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import * as cel from "@hypercerts-org/lexicon/org/hypercerts/workscope/cel";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  parseInput,
  prepareChecked,
} from "../internal/build-context.js";
import { describeValue } from "../internal/describe.js";
import { blobOrUrl, compact, dateRange, strictObject } from "../internal/input.js";
import { mediaValue } from "../internal/media.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import {
  assertDistinctKeys,
  type ExistingRecord,
  flattenSlots,
  isInputObject,
  newSlots,
  prepareNew,
  type ReferenceOf,
  readBeforeWriting,
  recordRef,
  referenceLookup,
  resultOf,
  type Slot,
  type SupportingRecordRef,
  toSlot,
} from "../internal/slots.js";
import { assertWithinWriteLimit, submitWrites } from "../internal/submit-writes.js";
import { type LocationInput, locationKind } from "../location/build-location.js";
import {
  type WorkScopeTagInput,
  type WorkScopeTagResult,
  workScopeTagKind,
} from "../tag/build-tag.js";
import { type ContributionInput, contributionKind } from "./build-contribution.js";
import {
  type ContributorInformationInput,
  contributorInformationKind,
} from "./build-contributor-information.js";
import { type RightsInput, rightsKind } from "./build-rights.js";

/**
 * A value the Activity stores directly, without a supporting record: a contributor's identity
 * string (a DID or a name) or role.
 */
export interface InlineValue {
  inline: string;
}

/** One contributor of an Activity. */
export interface ContributorInput {
  /**
   * Who contributed: the data of a new contributor-information record, the URI of an existing
   * one, or `{ inline: "<DID or name>" }` to store only that string in the Activity.
   */
  identity: ContributorInformationInput | ExistingRecord | InlineValue;
  /**
   * What they did: the data of a new contribution record, the URI of an existing one, or
   * `{ inline: "<role>" }` to store only the role in the Activity.
   */
  details?: ContributionInput | ExistingRecord | InlineValue | undefined;
  /**
   * The share of this contribution, a positive decimal number written as a string (for example
   * `"2"` or `"0.5"`). Weights need not add up to anything; consumers normalise them.
   */
  weight?: string | undefined;
}

/**
 * A structured work scope: a CEL (Common Expression Language) expression and the work-scope tags
 * it uses.
 *
 * @remarks
 * The expression is stored exactly as written. The SDK does not parse, evaluate or check it, so
 * it does not notice a tag that the expression names but `usedTags` leaves out, or the reverse.
 */
export interface CelWorkScopeInput {
  /**
   * The CEL expression, for example `scope.hasAll(['mangrove_restoration']) && location.country
   * == 'KE'`. At most 10000 characters and 5000 graphemes.
   */
  expression: string;
  /**
   * The work-scope tags the expression uses, at most 100: each entry is the data of a new
   * `org.hypercerts.workscope.tag` record, created in the same write, or `{ uri }` of an existing
   * one.
   */
  usedTags: readonly (WorkScopeTagInput | ExistingRecord)[];
  /** The version of the CEL context schema. Defaults to `"v1"`. At most 16 characters. */
  version?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/** The data of a new `org.hypercerts.claim.activity` record and the supporting records it needs. */
export interface ActivityInput {
  /** A display title. At most 256 characters. */
  title: string;
  /** A summary for previews, at most 300 characters. */
  shortDescription: string;
  /** A long description as plain text or Markdown. */
  description?: string | undefined;
  /** Languages of the text fields as BCP-47 tags (up to three), for example `["en"]`. */
  langs?: readonly string[] | undefined;
  /**
   * A picture of the work: an image `Blob` or `File` (JPEG, PNG or WebP, up to 5 MB) that the SDK
   * uploads, or a URL string that is stored as it is.
   */
  image?: Blob | string | undefined;
  /**
   * The work scope: a free-form description, or a structured CEL scope. See
   * {@link CelWorkScopeInput}.
   */
  workScope?: string | CelWorkScopeInput | undefined;
  /** An ISO 8601 date-time: when the work began. */
  startDate?: string | undefined;
  /** An ISO 8601 date-time, not before `startDate`: when the work ended. */
  endDate?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
  /** The rights: the data of a new rights record, or the URI of an existing one. */
  rights?: RightsInput | ExistingRecord | undefined;
  /** Where the work happened: each entry is the data of a new location or the URI of an existing one. */
  locations?: readonly (LocationInput | ExistingRecord)[] | undefined;
  /** The contributors. See {@link ContributorInput}. */
  contributors?: readonly ContributorInput[] | undefined;
}

/** What a {@link createActivity} call stored for one contributor, in the order of the input. */
export interface ContributorResult {
  /** The contributor-information record, or the inline identity string. */
  identity: SupportingRecordRef | InlineValue;
  /** The contribution record, or the inline role. Absent when the input had no `details`. */
  details?: SupportingRecordRef | InlineValue;
}

/**
 * The result of {@link createActivity}.
 *
 * @remarks
 * Every supporting field mirrors the input: `locations[i]` and `contributors[i]` belong to the
 * input entry at the same index, whether it was created, reused or inline. Filter on `created`
 * for only the records this call wrote.
 */
export interface CreateActivityResult {
  /** The URI of the new Activity. */
  uri: StrongRef["uri"];
  /** The CID of the new Activity. */
  cid: StrongRef["cid"];
  /** The rights record, when the input had `rights`. */
  rights?: SupportingRecordRef;
  /** The work-scope tags of a CEL `workScope`, in input order. Absent for a free-form scope. */
  workScope?: { usedTags: readonly WorkScopeTagResult[] };
  /** The location records, in input order. */
  locations: readonly SupportingRecordRef[];
  /** The contributors, in input order. */
  contributors: readonly ContributorResult[];
}

const weight = l.refine(l.string(), {
  check: (value: string) => /^\d+(\.\d+)?$/.test(value) && Number(value) > 0,
  message: 'must be a positive decimal number written as a string, for example "1" or "0.25"',
});

// The choices of `rights`, `locations` and a contributor's fields are read by `toSlot`, which
// knows what each may hold, so the schema only says where they are.
const contributorShape = strictObject({
  identity: l.unknown(),
  details: l.optional(l.unknown()),
  weight: l.optional(weight),
});

const celWorkScope = strictObject({
  expression: l.string(),
  usedTags: l.array(l.unknown()),
  version: l.optional(l.string()),
  createdAt: l.optional(l.string()),
});

const activityInput = l.refine(
  strictObject({
    title: l.string(),
    shortDescription: l.string(),
    description: l.optional(l.string()),
    langs: l.optional(l.array(l.string())),
    image: l.optional(blobOrUrl),
    workScope: l.optional(l.unknown()),
    startDate: l.optional(l.string()),
    endDate: l.optional(l.string()),
    createdAt: l.optional(l.string()),
    rights: l.optional(l.unknown()),
    locations: l.optional(l.array(l.unknown())),
    contributors: l.optional(l.array(contributorShape)),
  }),
  dateRange,
);

interface ContributorPlan {
  identity: Slot;
  details: Slot | undefined;
  weight: string | undefined;
}

type WorkScopePlan =
  | { kind: "text"; scope: string }
  | {
      kind: "cel";
      expression: string;
      version: string;
      createdAt: string;
      usedTags: Slot[];
    };

interface ActivityPlan {
  workScope: WorkScopePlan | undefined;
  rights: Slot | undefined;
  locations: Slot[];
  contributors: ContributorPlan[];
}

// Reads every choice, and with it every nested record's data, before any request is sent.
function planActivity(build: BuildContext, input: l.InferOutput<typeof activityInput>) {
  return {
    workScope: planWorkScope(build, input.workScope),
    rights:
      input.rights === undefined
        ? undefined
        : toSlot(build, "rights", input.rights, rightsKind, false),
    locations: (input.locations ?? []).map((value, i) =>
      toSlot(build, `locations[${i}]`, value, locationKind, false),
    ),
    contributors: (input.contributors ?? []).map((contributor, i): ContributorPlan => {
      const field = `contributors[${i}]`;
      return {
        identity: toSlot(
          build,
          `${field}.identity`,
          contributor.identity,
          contributorInformationKind,
          true,
        ),
        details:
          contributor.details === undefined
            ? undefined
            : toSlot(build, `${field}.details`, contributor.details, contributionKind, true),
        weight: contributor.weight,
      };
    }),
  } satisfies ActivityPlan;
}

function planWorkScope(build: BuildContext, value: unknown): WorkScopePlan | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { kind: "text", scope: value };
  if (!isInputObject(value)) {
    throw new TypeError(
      `${build.operation}: workScope must be a string (a free-form description) or { expression, usedTags } (a CEL scope), but received ${describeValue(value)}.`,
    );
  }
  const scope = parseInput(build, "workScope", celWorkScope, value);
  return {
    kind: "cel",
    expression: scope.expression,
    version: scope.version ?? "v1",
    createdAt: scope.createdAt ?? build.createdAt,
    usedTags: scope.usedTags.map((tag, i) =>
      toSlot(build, `workScope.usedTags[${i}]`, tag, workScopeTagKind, false),
    ),
  };
}

// The slots the Activity points at, in the order their records are written, nested ones before the
// records that point at them.
function allSlots(plan: ActivityPlan): Slot[] {
  return flattenSlots([
    ...(plan.workScope?.kind === "cel" ? plan.workScope.usedTags : []),
    ...(plan.rights ? [plan.rights] : []),
    ...plan.locations,
    ...plan.contributors.flatMap(({ identity, details }) =>
      details ? [identity, details] : [identity],
    ),
  ]);
}

/**
 * Creates an Activity (`org.hypercerts.claim.activity`) together with the rights, locations,
 * contributor-information, contribution and work-scope tag records it needs, in one atomic write.
 *
 * @remarks
 * Each supporting field says what you want with a tagged choice, so intent is never guessed:
 * - the fields of a record (a plain object) create a new record;
 * - `{ uri }` reuses an existing record, whose current CID is read and which is never rewritten.
 *   Its type must match the field, for example only `org.hypercerts.claim.rights` for `rights`;
 * - `{ inline: "..." }`, for a contributor's `identity` and `details` only, stores that string in
 *   the Activity itself (the lexicon's `contributorIdentity` and `contributorRole`) without a
 *   record.
 *
 * Nothing is searched for or deduplicated: two calls with the same data create two sets of records.
 *
 * `workScope` is either a free-form string or a structured CEL scope, `{ expression, usedTags }`
 * (see {@link CelWorkScopeInput}). Each entry of `usedTags` is the data of a new work-scope tag,
 * created in the same write, or `{ uri }` of an existing one, and a new tag may itself point at a
 * new or existing `parent` and `supersededBy` tag (see `createWorkScopeTag` in
 * `@hypercerts-org/sdk/tag`). The expression is stored exactly as written: the SDK does not parse,
 * evaluate or check it.
 *
 * Every record's key and CID are worked out locally before anything is sent, so the Activity can
 * reference the new records by strong reference, and one `com.atproto.repo.applyWrites` request
 * then creates the Activity and every new supporting record. The PDS commits that request as a
 * whole: all of the records exist afterwards or none do. This is the PDS's guarantee; the SDK's
 * end-to-end tests check it by making one record of the request fail on a real PDS.
 *
 * Metadata defaults: `createdAt` is the time of the call (one timestamp for all the records the
 * call creates) unless you set it on a record. Every new record gets a new TID as its record key,
 * chosen by the SDK.
 *
 * One `applyWrites` request holds at most 200 records on the reference PDS, so a call that would
 * create more (the Activity included) fails before anything is uploaded, and the SDK does not split
 * it, because the records must be committed together.
 *
 * Not supported: the lexicon's `signatures`, `shortDescriptionFacets` and a `description` that is
 * not a string.
 *
 * Blobs (`Blob` or `File` values for `image` and attachments) are uploaded before the write, and
 * URL strings are stored as they are and never fetched. Uploads are outside the atomic write: if
 * the PDS rejects the write, this call leaves the uploaded blobs unreferenced. A PDS usually deletes unreferenced blobs after a while, but this is not guaranteed, and a blob
 * with the same content that another record already uses stays.
 * After {@link WriteOutcomeUnknownError} or {@link WriteResultMismatchError} the records may exist,
 * so the blobs may be referenced and publicly readable. The order is: validate the input, read the existing records, upload blobs, validate each
 * record against its lexicon, write. A failed read or an input error stops before any upload; a
 * lexicon rule that rejects a record is only found after the blobs are uploaded.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The Activity and its supporting records. See {@link ActivityInput}.
 * @returns The new Activity's URI and CID, and the references of the supporting records that
 * were created. See {@link CreateActivityResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a mixed or wrongly typed choice (a
 * rights URI that points at another record type, `{ uri }` combined with record fields, a
 * `workScope.usedTags` URI that is not a work-scope tag), an invalid weight, an `endDate` before
 * its `startDate`, more new records than one write holds, or any value the lexicons do not allow.
 * The message names the field. Nothing was written. Blobs may already have been uploaded when a
 * lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, or
 * an upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). None of the records
 * was created and nothing needs cleaning up.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS (network
 * failure, timeout, a server error), so the records may or may not exist. It lists every URI that
 * was attempted. The SDK does not retry, because a retry would create duplicates under new keys
 * if the first attempt had succeeded. Check the URIs, then decide.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed, so the references between the new records may not match what is stored.
 *
 * @example Creating an Activity with new and existing supporting records
 * ```ts
 * import { createActivity } from "@hypercerts-org/sdk/activity";
 *
 * // `context` comes from createSDKContext; `logo` is a File from an <input type="file">.
 * const result = await createActivity(context, {
 *   title: "Reforestation in the Phobjikha valley",
 *   shortDescription: "Planting 5,000 native trees.",
 *   image: logo,
 *   startDate: "2024-03-01T00:00:00Z",
 *   rights: { uri: "at://did:plc:abc123/org.hypercerts.claim.rights/3k2a4b5c6d7e8" }, // reused
 *   locations: [
 *     {
 *       lpVersion: "1.0",
 *       srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *       locationType: "coordinate-decimal",
 *       location: { string: "90.17,27.47" },
 *       name: "Phobjikha valley",
 *     }, // created
 *   ],
 *   contributors: [
 *     { identity: { displayName: "Alice" }, details: { role: "Lead" }, weight: "2" }, // both created
 *     { identity: { inline: "did:plc:bob456" }, details: { inline: "Volunteer" } }, // stored inline
 *   ],
 * });
 * console.log(result.uri, result.locations[0]); // { uri, cid, created: true }
 * ```
 *
 * @example A structured work scope with a new and an existing tag
 * ```ts
 * import { createActivity } from "@hypercerts-org/sdk/activity";
 *
 * await createActivity(context, {
 *   title: "Mangrove restoration in Kenya",
 *   shortDescription: "Replanting 20 hectares of mangrove.",
 *   workScope: {
 *     expression: "scope.hasAll(['mangrove_restoration', 'environmental_education'])",
 *     usedTags: [
 *       { key: "mangrove_restoration", name: "Mangrove restoration" }, // created
 *       { uri: "at://did:plc:abc123/org.hypercerts.workscope.tag/3k2a4b5c6d7e8" }, // reused
 *     ],
 *   },
 * });
 * ```
 *
 * @example Handling an unknown outcome
 * ```ts
 * import { createActivity, WriteOutcomeUnknownError } from "@hypercerts-org/sdk/activity";
 *
 * try {
 *   await createActivity(context, input);
 * } catch (error) {
 *   if (error instanceof WriteOutcomeUnknownError) {
 *     // Check these with com.atproto.repo.getRecord before deciding whether to try again.
 *     console.log(error.attempted.map((ref) => ref.uri));
 *   }
 *   throw error;
 * }
 * ```
 *
 * @example A wrong record type fails before anything is sent
 * ```ts
 * await createActivity(context, {
 *   title: "…",
 *   shortDescription: "…",
 *   rights: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // TypeError
 * });
 * ```
 *
 * @example A vocabulary tag is not a work-scope tag
 * ```ts
 * await createActivity(context, {
 *   title: "…",
 *   shortDescription: "…",
 *   workScope: {
 *     expression: "scope.has('site')",
 *     // TypeError: this field holds org.hypercerts.workscope.tag
 *     usedTags: [{ uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/zone-role.site" }],
 *   },
 * });
 * ```
 */
export async function createActivity(
  context: SDKContext,
  input: ActivityInput,
): Promise<CreateActivityResult> {
  const build = createBuildContext(context, "createActivity");
  const parsed = parseInput(build, "input", activityInput, input);
  const plan = planActivity(build, parsed);
  const slots = allSlots(plan);
  const fresh = newSlots(slots);
  assertDistinctKeys(build, fresh);
  // The Activity itself is one more record in the write.
  assertWithinWriteLimit("createActivity", fresh.length + 1);

  // Reads first, then uploads: a URI that cannot be resolved fails before anything is uploaded.
  const existing = await readBeforeWriting(build, slots, { checkKeys: true });
  const [image, created] = await Promise.all([
    parsed.image === undefined ? undefined : mediaValue(build, "image", parsed.image, "image"),
    prepareNew(slots, existing),
  ]);

  const refOf = referenceLookup(existing, created);
  const record = await prepareChecked(
    build,
    "the Activity",
    activity.main,
    activityRecord(build, parsed, plan, image, refOf),
  );
  await submitWrites(context, build.did, [...created.values(), record], "createActivity");
  return { ...record.ref, ...summarise(plan, created, refOf) };
}

function activityRecord(
  build: BuildContext,
  input: l.InferOutput<typeof activityInput>,
  plan: ActivityPlan,
  image: l.$Typed<defs.Uri> | l.$Typed<defs.SmallImage> | undefined,
  refOf: ReferenceOf,
) {
  return compact({
    title: input.title,
    shortDescription: input.shortDescription,
    description:
      input.description === undefined
        ? undefined
        : defs.descriptionString.build({ value: input.description }),
    langs: input.langs as l.LanguageString[] | undefined,
    image,
    workScope: plan.workScope && workScopeValue(plan.workScope, refOf),
    startDate: input.startDate as l.DatetimeString | undefined,
    endDate: input.endDate as l.DatetimeString | undefined,
    rights: plan.rights && refOf(plan.rights),
    locations: plan.locations.length === 0 ? undefined : plan.locations.map(refOf),
    contributors:
      plan.contributors.length === 0
        ? undefined
        : plan.contributors.map((contributor) => contributorEntry(contributor, refOf)),
    createdAt: (input.createdAt ?? build.createdAt) as l.DatetimeString,
  });
}

function workScopeValue(scope: WorkScopePlan, refOf: ReferenceOf) {
  if (scope.kind === "text") return activity.workScopeString.build({ scope: scope.scope });
  return cel.main.build({
    expression: scope.expression,
    usedTags: scope.usedTags.map(refOf),
    version: scope.version,
    createdAt: scope.createdAt as l.DatetimeString,
  });
}

function contributorEntry({ identity, details, weight }: ContributorPlan, refOf: ReferenceOf) {
  return compact({
    contributorIdentity: inlineOrReference(identity, refOf, (identity) =>
      activity.contributorIdentity.build({ identity }),
    ),
    contributionWeight: weight,
    contributionDetails:
      details &&
      inlineOrReference(details, refOf, (role) => activity.contributorRole.build({ role })),
  });
}

// Inside the contributor unions a strong reference carries its `$type`, unlike the plain
// references in `rights` and `locations`; the lexicon cannot tell the union's members apart
// otherwise.
function inlineOrReference<T>(slot: Slot, refOf: ReferenceOf, inline: (value: string) => T) {
  return slot.choice.kind === "inline"
    ? inline(slot.choice.value)
    : strongRef.main.build(refOf(slot));
}

// Mirrors the input's shape so callers can match each result to the entry they passed.
function summarise(
  plan: ActivityPlan,
  created: ReadonlyMap<Slot, PreparedRecord>,
  refOf: ReferenceOf,
): Omit<CreateActivityResult, "uri" | "cid"> {
  const reference = (slot: Slot): SupportingRecordRef => recordRef(slot, created, refOf);
  const entry = (slot: Slot): SupportingRecordRef | InlineValue =>
    slot.choice.kind === "inline" ? { inline: slot.choice.value } : reference(slot);
  const { workScope } = plan;
  return compact({
    rights: plan.rights && reference(plan.rights),
    workScope:
      workScope?.kind === "cel"
        ? {
            usedTags: workScope.usedTags.map((tag) =>
              resultOf<WorkScopeTagResult>(tag, created, refOf),
            ),
          }
        : undefined,
    locations: plan.locations.map(reference),
    contributors: plan.contributors.map(({ identity, details }) =>
      compact({ identity: entry(identity), details: details && entry(details) }),
    ),
  });
}
