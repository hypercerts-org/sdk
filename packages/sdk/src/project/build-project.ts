import { l } from "@atproto/lex";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import {
  type ActivityEntryResult,
  entryWeight,
  existingActivitySlot,
} from "../activity/activity-entry.js";
import { type ActivityInput, activityTextFields } from "../activity/create-activity.js";
import {
  type CollectionInput,
  type CreateCollectionItemResult,
  type CreateCollectionResult,
  planCollection,
} from "../collection/build-collection.js";
import { type BuildContext, parseInput } from "../internal/build-context.js";
import { describeError } from "../internal/describe.js";
import { compact, optionalMedia, strictObject } from "../internal/input.js";
import type { LeafletDocument } from "../internal/long-description.js";
import { assertWithinLimits } from "../internal/media.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import {
  type ExistingRecord,
  isExistingRecord,
  isInputObject,
  prepareSlots,
  type SupportingRecordRef,
} from "../internal/slots.js";
import type { CreateVocabularyTagResult } from "../tag/build-tag.js";

/**
 * One Activity of a new Project, with an optional `weight`.
 *
 * @remarks
 * `activity` is the data of a new Activity (see {@link ActivityInput}) or `{ uri }` of an existing
 * one, reused and never changed. The weight sits beside it, not inside.
 */
export interface ProjectActivityInput {
  /** The Activity: the data of a new one, or `{ uri }` of an existing one. */
  activity: ActivityInput | ExistingRecord;
  /** A positive decimal as a string, such as `"2"` or `"0.5"`, kept as written. Up to 100 chars. */
  weight?: string | undefined;
}

/**
 * The data of a new Project: {@link CollectionInput} without `type` and `items`, plus `activities`.
 * See {@link createProject} for what the default Activity copies.
 */
export interface ProjectInput
  extends Omit<CollectionInput, "type" | "items" | "title" | "shortDescription"> {
  /** The display name, up to 800 bytes and 80 graphemes. The default Activity allows 256 bytes. */
  title: string;
  /** A summary, at most 3000 characters and 300 graphemes. Required without `activities`. */
  shortDescription?: string | undefined;
  /**
   * The Activities, in the order stored, at most 1000. Omitted or empty: one default Activity is
   * created from the Project. See {@link ProjectActivityInput}.
   */
  activities?: readonly ProjectActivityInput[] | undefined;
}

/**
 * What {@link createProject} did for one Activity: created it (with its records) or reused it.
 * Narrow on `created`.
 */
export type ProjectActivityResult = ActivityEntryResult;

/**
 * The result of {@link createProject}: the Project's `uri` and `cid`, its `location` and `tags`, and
 * `activities` in place of the Collection's `items`. Each result has the index of its input entry.
 */
export interface CreateProjectResult extends StrongRef {
  /** The location, when the input had `location`. */
  location?: SupportingRecordRef;
  /** The vocabulary tags, in input order. */
  tags: readonly CreateVocabularyTagResult[];
  /** The Activities, in input order. `created` is `false` for one passed by `uri`. */
  activities: readonly ProjectActivityResult[];
}

/** A Project and its new records, validated and ready to submit. Nothing is written. */
interface PreparedProject {
  /** The records to create, in the order to submit them: the Project is last. */
  readonly writes: readonly PreparedRecord[];
  /** What the caller gets back once the writes are committed. */
  readonly result: CreateProjectResult;
}

// The lexicon's limit on `items`, checked here so that messages name `activities` as the caller
// wrote it.
const MAX_ACTIVITIES = 1000;

// `type` and `items` are refused with advice, before the schema's general "unknown field".
const REFUSED_FIELDS = {
  type: 'a Project always has type "project". To create a Collection of another type, use createCollection from @hypercerts-org/sdk/collection',
  items:
    "a Project lists its Activities in `activities`, each { activity, weight? } with the data of a new Activity or { uri } of an existing one. To add Features or child Collections, use createCollection from @hypercerts-org/sdk/collection",
} as const;

// `planCollection` checks the fields. This list reports a misspelled field with the Project's own
// fields, and `satisfies` fails to compile when `ProjectInput` gains a field it lacks.
const passedOn = l.optional(l.unknown());
const projectInput = strictObject({
  title: passedOn,
  shortDescription: passedOn,
  shortDescriptionFacets: passedOn,
  description: passedOn,
  langs: passedOn,
  avatar: passedOn,
  banner: passedOn,
  location: passedOn,
  tags: passedOn,
  createdAt: passedOn,
  activities: l.optional(l.array(l.unknown(), { maxLength: MAX_ACTIVITIES })),
} satisfies Record<keyof ProjectInput, l.Validator>);

const activityEntry = strictObject({ activity: l.unknown(), weight: entryWeight });

// What the default Activity copies: the Activity's text fields, and the banner as its image.
const copiedFields = l.object({ ...activityTextFields, banner: optionalMedia });

// The copied text fields, typed as the Activity's input has them.
type CopiedText = Omit<l.InferOutput<typeof copiedFields>, "banner" | "shortDescriptionFacets"> &
  Pick<ActivityInput, "shortDescriptionFacets">;

// An Activity's `image` holds up to 5 MiB, a Project's `banner` 10 MiB, of the same image types.
const ACTIVITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Validates a Project's input, reads what it points at, uploads its files and prepares every record
 * it creates, the Project last.
 *
 * Internal. Plans the Project as a Collection of type `project` whose items are its `activities`.
 *
 * Throws TypeError, naming the field, for a problem in the input, and what `prepareSlots` throws.
 */
export async function prepareProject(
  build: BuildContext,
  value: unknown,
): Promise<PreparedProject> {
  const { collection, hasDefaultActivity } = readProject(build, value);
  const planned = planCollection(build, "input", collection, {
    items: "input.activities",
    uri: "activity.uri",
    // The default Activity's image is the Project's banner.
    activityImage: (index) => (hasDefaultActivity && index === 0 ? "input.banner" : undefined),
  });
  // Reads before uploads: an unreadable URI or a taken tag key fails before anything is uploaded.
  const { created, refOf } = await prepareSlots(build, [planned.slot], { checkKeys: true });
  return {
    writes: [...created.values()],
    result: projectResult(planned.result(created, refOf)),
  };
}

// The Project as a Collection's input: type `project`, its Activities (or the default) as items.
function readProject(build: BuildContext, value: unknown) {
  const { activities, ...project } = parseProjectInput(build, value);
  const entries = (activities ?? []).map((entry, i) =>
    planEntry(build, `input.activities[${i}]`, entry),
  );
  const hasDefaultActivity = entries.length === 0;
  const items = hasDefaultActivity ? [{ activity: defaultActivity(build, project) }] : entries;
  return { collection: { ...project, type: "project", items }, hasDefaultActivity };
}

function parseProjectInput(build: BuildContext, value: unknown) {
  if (isInputObject(value)) {
    for (const [field, advice] of Object.entries(REFUSED_FIELDS)) {
      if (field in value)
        throw new TypeError(`${build.operation}: input.${field} is not accepted: ${advice}.`);
    }
  }
  return parseInput(build, "input", projectInput, value);
}

// An entry of `activities` as the item of a Collection, which is what `planCollection` takes.
function planEntry(build: BuildContext, field: string, value: unknown) {
  const { activity, weight } = parseInput(build, field, activityEntry, value);
  if (!isExistingRecord(activity)) return { activity, weight };
  // `planCollection` would accept a Feature or a Collection, so the type is checked here.
  existingActivitySlot(build, `${field}.activity`, activity);
  return { uri: activity.uri, weight };
}

// The default Activity copies the Project's text fields and its banner as the image. A value that
// does not fit is an error, never shortened. The Project's limits are checked first, so "pass
// `activities`" is only advised for what the Project accepts and the Activity does not.
function defaultActivity(
  build: BuildContext,
  project: Pick<
    l.InferOutput<typeof projectInput>,
    "title" | "shortDescription" | "shortDescriptionFacets" | "description" | "langs" | "banner"
  >,
): ActivityInput {
  if (project.shortDescription === undefined) {
    throw new TypeError(
      `${build.operation}: input.shortDescription is required when \`activities\` is omitted or empty, because the Project then gets one default Activity, which copies input.title, input.shortDescription and more of the Project. Pass shortDescription, or pass \`activities\`.`,
    );
  }
  const { banner, ...text } = parseInput(
    build,
    "input",
    copiedFields,
    compact({
      title: project.title,
      shortDescription: project.shortDescription,
      shortDescriptionFacets: project.shortDescriptionFacets,
      description: project.description,
      langs: project.langs,
      banner: project.banner,
    }),
  );
  const copy: CopiedText = {
    ...text,
    shortDescriptionFacets: text.shortDescriptionFacets as ActivityInput["shortDescriptionFacets"],
  };
  assertRecordsAccept(build, copy, banner);
  return compact({ ...copy, image: activityImage(build, banner) });
}

// Checks the copied fields against both lexicons, the Project's first, before anything is read or
// uploaded. A `{ uri }` description and a file are left out: their CIDs are not known yet.
function assertRecordsAccept(
  build: BuildContext,
  copy: CopiedText,
  banner: Blob | string | undefined,
) {
  const checkable = compact({ ...copy, description: inlineDescription(copy.description) });
  const uri =
    typeof banner === "string" ? defs.uri.build({ uri: banner as l.UriString }) : undefined;
  const createdAt = build.createdAt as l.DatetimeString;
  const asProject = collection.main.safeValidate(
    collection.main.build({
      ...checkable,
      ...compact({ banner: uri }),
      type: "project",
      createdAt,
    }),
  );
  if (!asProject.success) {
    throw new TypeError(
      `${build.operation}: input is not a valid ${collection.main.$type} record: ${describeError(asProject.reason)}.`,
      { cause: asProject.reason },
    );
  }
  const asActivity = activity.main.safeValidate(
    activity.main.build({ ...checkable, ...compact({ image: uri }), createdAt }),
  );
  if (!asActivity.success) {
    throw new TypeError(
      `${build.operation}: the default Activity copies fields of the Project, but they are not valid for an ${activity.main.$type} record: ${describeError(asActivity.reason)}. The SDK never shortens them. Shorten them, or pass \`activities\`.`,
      { cause: asActivity.reason },
    );
  }
}

// A URL is copied as it is. A file is copied only if the Activity can hold it; a larger one is left
// out, not an error. It is the same `Blob`, so `uploadField` uploads it once for both records.
function activityImage(build: BuildContext, banner: Blob | string | undefined) {
  if (banner === undefined || typeof banner === "string") return banner;
  // The Project's rule first, so a bad file is reported as `input.banner`.
  assertWithinLimits(build, "input.banner", banner, "largeImage");
  return banner.size <= ACTIVITY_IMAGE_MAX_BYTES ? banner : undefined;
}

// A string or Leaflet description as stored. A `{ uri }` has none until its record is read.
function inlineDescription(description: string | LeafletDocument | ExistingRecord | undefined) {
  if (isExistingRecord(description)) return undefined;
  return typeof description === "string"
    ? defs.descriptionString.build({ value: description })
    : description;
}

function projectResult({ items, ...project }: CreateCollectionResult): CreateProjectResult {
  return { ...project, activities: items.map(activityResult) };
}

// Every item of a Project is an Activity, because `planEntry` accepts nothing else.
function activityResult(item: CreateCollectionItemResult): ProjectActivityResult {
  if (item.type !== "activity") {
    throw new Error(
      `createProject: expected an Activity but planned a ${item.type}. This is a bug in the SDK.`,
    );
  }
  const { type: _type, ...result } = item;
  return result;
}
