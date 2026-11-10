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
import { blobOrUrl, compact, dateRange, strictObject, weightString } from "../internal/input.js";
import { mediaValue } from "../internal/media.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import {
  assertDistinctKeys,
  type ExistingRecord,
  flattenSlots,
  isInputObject,
  type NewSlot,
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

// The choices of `rights`, `locations` and a contributor's fields are read by `toSlot`, which
// knows what each may hold, so the schema only says where they are.
const contributorShape = strictObject({
  identity: l.unknown(),
  details: l.optional(l.unknown()),
  weight: l.optional(weightString),
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

// Reads every choice, and with it every nested record's data, before any request is sent. `at`
// prefixes the field names in messages when the Activity is nested in a larger input.
function planActivity(build: BuildContext, input: l.InferOutput<typeof activityInput>, at: string) {
  return {
    workScope: planWorkScope(build, input.workScope, at),
    rights:
      input.rights === undefined
        ? undefined
        : toSlot(build, `${at}rights`, input.rights, rightsKind, false),
    locations: (input.locations ?? []).map((value, i) =>
      toSlot(build, `${at}locations[${i}]`, value, locationKind, false),
    ),
    contributors: (input.contributors ?? []).map((contributor, i): ContributorPlan => {
      const field = `${at}contributors[${i}]`;
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

function planWorkScope(build: BuildContext, value: unknown, at: string): WorkScopePlan | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { kind: "text", scope: value };
  if (!isInputObject(value)) {
    throw new TypeError(
      `${build.operation}: ${at}workScope must be a string (a free-form description) or { expression, usedTags } (a CEL scope), but received ${describeValue(value)}.`,
    );
  }
  const scope = parseInput(build, `${at}workScope`, celWorkScope, value);
  return {
    kind: "cel",
    expression: scope.expression,
    version: scope.version ?? "v1",
    createdAt: scope.createdAt ?? build.createdAt,
    usedTags: scope.usedTags.map((tag, i) =>
      toSlot(build, `${at}workScope.usedTags[${i}]`, tag, workScopeTagKind, false),
    ),
  };
}

// The slots of the records the Activity points at directly, in the order their records are written.
// Records that those point at are found by `flattenSlots` and are written before them. An inline
// value is stored in the Activity and is no record, so it is left out.
function supportingSlots(plan: ActivityPlan): Slot[] {
  return [
    ...(plan.workScope?.kind === "cel" ? plan.workScope.usedTags : []),
    ...(plan.rights ? [plan.rights] : []),
    ...plan.locations,
    ...plan.contributors.flatMap(({ identity, details }) =>
      details ? [identity, details] : [identity],
    ),
  ].filter((slot) => slot.choice.kind !== "inline");
}

/**
 * Creates an Activity (`org.hypercerts.claim.activity`) together with the rights, locations,
 * contributor-information, contribution and work-scope tag records it needs, in one atomic write.
 *
 * @remarks
 * Each supporting field takes one of:
 * - a new record's fields, to create it;
 * - `{ uri }` of an existing record of the right type, reused as it is;
 * - `{ inline: "..." }` (a contributor's `identity` and `details` only), stored in the Activity
 *   itself without a record.
 *
 * Nothing is deduplicated: two calls with the same data create two sets of records.
 *
 * `workScope` is a string or a CEL scope, `{ expression, usedTags }` (see {@link CelWorkScopeInput}).
 * The expression is stored as written; the SDK does not check it.
 *
 * Everything is created in one write: all the records exist afterwards, or none do. One write holds
 * at most 200 records, the Activity included. `createdAt` defaults to the time of the call.
 *
 * Not supported: `signatures`, `shortDescriptionFacets` and a non-string `description`.
 *
 * Files (`Blob` or `File` values) are uploaded: the Activity's `image`, a new rights record's
 * `attachment`, a new contributor's `image` and a new location's `{ blob }`. Blobs are uploaded
 * before the write and are not rolled back if it fails; see {@link uploadBlob}. Input errors are
 * found before any upload; a lexicon rule that rejects a record is found only after.
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
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create duplicates under new keys if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
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
  const { writes, result } = await prepareActivity(build, input);
  await submitWrites(context, build.did, writes, "createActivity");
  return result;
}

/** An Activity and its new supporting records, validated and ready to submit. Nothing is written. */
export interface PreparedActivity {
  /** The records to create, in the order to submit them: the new supporting records, then the Activity. */
  readonly writes: readonly PreparedRecord[];
  /** What the caller gets back once the writes are committed. */
  readonly result: CreateActivityResult;
}

/**
 * An Activity whose input is validated and whose supporting records are planned, with nothing read,
 * uploaded or written yet.
 */
export interface PlannedActivity {
  /**
   * The Activity as a record to create. The supporting records it points at are its references,
   * so `flattenSlots` finds them, and they are prepared before it.
   */
  readonly slot: NewSlot;
  /** What the caller gets back for the Activity, once its records are prepared. */
  readonly result: (
    created: ReadonlyMap<Slot, PreparedRecord>,
    refOf: ReferenceOf,
  ) => CreateActivityResult;
}

/**
 * Validates the input of an Activity and plans it and its supporting records, without sending any
 * request: no record is read, no file uploaded, no record written. The `image` is uploaded when the
 * slot is prepared (see `prepareNew`), after the records it points at have been built.
 *
 * Internal. `prepareActivity` plans, reads and prepares one Activity on its own. A call that
 * creates several Activities (see `createCollection`) plans them all, so that it can count the
 * records and read every existing one before anything is uploaded.
 *
 * `path` names the Activity's data in messages when it is part of a larger input, for example
 * `activity` gives `activity.locations[0]`; omit it when the input is the Activity itself.
 *
 * Throws TypeError, naming the field, for any problem in the input.
 */
export function planActivitySlot(
  build: BuildContext,
  input: unknown,
  path?: string,
): PlannedActivity {
  const field = path ?? "input";
  const at = path === undefined ? "" : `${path}.`;
  const parsed = parseInput(build, field, activityInput, input);
  const plan = planActivity(build, parsed, at);
  const slot: NewSlot = {
    collection: activity.main.$type,
    field,
    choice: {
      kind: "new",
      key: undefined,
      references: { supporting: supportingSlots(plan) },
      prepare: async (refOf) => {
        const image =
          parsed.image === undefined
            ? undefined
            : await mediaValue(build, `${at}image`, parsed.image, "image");
        return prepareChecked(
          build,
          path ?? "the Activity",
          activity.main,
          activityRecord(build, parsed, plan, image, refOf),
        );
      },
    },
  };
  return {
    slot,
    result: (created, refOf) => ({ ...refOf(slot), ...summarise(plan, created, refOf) }),
  };
}

/**
 * Does everything `createActivity` does before it writes: validates the input, reads the existing
 * records it points at, uploads blobs and prepares every new record, the Activity last.
 *
 * Internal. `createActivity` submits the result as it is; operations that put the Activity in a
 * larger write (see `createActivityInCollection`) submit it together with their own writes. Uploads
 * are not undone if the caller never submits the writes.
 *
 * `options.path` names the Activity's data in messages when it is part of a larger input, for
 * example `activity` gives `activity.locations[0]`; omit it when the input is the Activity itself.
 * `options.otherWrites` counts the writes the caller adds to the same request, so a call that
 * would not fit in one write fails before anything is uploaded.
 *
 * Throws what `createActivity` throws before its write: TypeError for invalid input and Error for
 * a failed read or upload.
 */
export async function prepareActivity(
  build: BuildContext,
  input: unknown,
  options: { path?: string; otherWrites?: number } = {},
): Promise<PreparedActivity> {
  const { path, otherWrites = 0 } = options;
  const planned = planActivitySlot(build, input, path);
  const slots = flattenSlots([planned.slot]);
  const fresh = newSlots(slots);
  assertDistinctKeys(build, fresh);
  // `fresh` holds the Activity itself too.
  assertWithinWriteLimit(build.operation, fresh.length + otherWrites);

  // Reads first, then uploads: a URI that cannot be resolved fails before anything is uploaded.
  const existing = await readBeforeWriting(build, slots, { checkKeys: true });
  const created = await prepareNew(slots, existing);
  return {
    writes: [...created.values()],
    result: planned.result(created, referenceLookup(existing, created)),
  };
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
