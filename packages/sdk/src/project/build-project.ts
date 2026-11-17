import { l } from "@atproto/lex";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import {
  type ActivityInput,
  activityTextFields,
  type CreateActivityResult,
} from "../activity/build-activity.js";
import {
  type CollectionInput,
  type CreateCollectionItemResult,
  type CreateCollectionResult,
  planCollection,
} from "../collection/build-collection.js";
import { type BuildContext, parseInput } from "../internal/build-context.js";
import { describeError } from "../internal/describe.js";
import { compact, optionalMedia, strictObject, weightString } from "../internal/input.js";
import type { LeafletDocument } from "../internal/long-description.js";
import { assertWithinLimits } from "../internal/media.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import {
  type ExistingRecord,
  isExistingRecord,
  isInputObject,
  prepareSlots,
  type SupportingRecordRef,
  toExistingSlot,
} from "../internal/slots.js";

/**
 * One Activity of a new Project: exactly one of `activity` or `uri`, with an optional `weight`.
 *
 * @remarks
 * The choice is explicit and never guessed from the fields, as for the items of
 * {@link createCollection}: the data of a new Activity goes under `activity`, an existing Activity
 * under `uri`. A bare Activity (`{ title, shortDescription }`) is not an entry. An existing
 * Activity is reused as it is and never changed; it must be an Activity, not a Feature or a
 * Collection.
 */
export type ProjectActivityInput = {
  /**
   * The weight of the Activity in the Project, a positive decimal number written as a string (for
   * example `"2"` or `"0.5"`). Weights need not add up to anything; consumers normalise them. The
   * string is stored as written. At most 100 characters. Left out when not set.
   */
  weight?: string | undefined;
} & (
  | {
      /** A new Activity and its supporting records. See {@link ActivityInput}. */
      activity: ActivityInput;
      uri?: never;
    }
  | {
      /**
       * An existing Activity as `at://<did>/org.hypercerts.claim.activity/<rkey>`, identified by a
       * DID, not a handle. It may belong to another account if it is public.
       */
      uri: string;
      activity?: never;
    }
);

/**
 * The data of a new Project: an `org.hypercerts.collection` of type `project`, and the Activities
 * it lists.
 *
 * @remarks
 * This is {@link CollectionInput} without `type` (always `project`) and `items` (see `activities`).
 * When `activities` is omitted or empty, the default Activity also copies the Project's
 * `shortDescriptionFacets`, `description`, `langs` and `banner`; see {@link createProject}.
 */
export interface ProjectInput
  extends Omit<CollectionInput, "type" | "items" | "title" | "shortDescription"> {
  /**
   * The display name. At most 800 bytes and 80 graphemes. Copied into the default Activity when
   * `activities` is omitted or empty, and an Activity's title holds at most 256 bytes.
   */
  title: string;
  /**
   * A summary for previews, at most 3000 characters and 300 graphemes. Required when `activities`
   * is omitted or empty: it is copied into the default Activity.
   */
  shortDescription?: string | undefined;
  /**
   * The Activities of the Project, in the order they are stored: each is the data of a new
   * Activity or `{ uri }` of an existing one, with an optional weight. At most 1000. Omitted or
   * empty: the SDK creates one default Activity from the Project (see {@link createProject}). See
   * {@link ProjectActivityInput}.
   */
  activities?: readonly ProjectActivityInput[] | undefined;
}

/**
 * What a {@link createProject} call did for one Activity, in the order of the input: whether it
 * created the Activity (`created`). For a new Activity the result also holds what the call created
 * for it: narrow on `created`.
 */
export type ProjectActivityResult =
  | (CreateActivityResult & { created: true })
  | (SupportingRecordRef & { created: false });

/**
 * The result of {@link createProject}.
 *
 * @remarks
 * A Project is a Collection, so `uri`, `cid`, `location` and `tags` are as in
 * {@link CreateCollectionResult}. `activities[i]` and `tags[i]` belong to the input entry at the
 * same index, whether it was created or reused. Filter on `created` for only the records this call
 * wrote.
 */
export interface CreateProjectResult extends Omit<CreateCollectionResult, "items"> {
  /**
   * The Activities, in input order. `created` is `true` for an Activity this call created, the
   * default one included, and `false` for one passed by `uri`.
   */
  activities: readonly ProjectActivityResult[];
}

/** A Project and its new records, validated and ready to submit. Nothing is written. */
export interface PreparedProject {
  /** The records to create, in the order to submit them: the Project is last. */
  readonly writes: readonly PreparedRecord[];
  /** What the caller gets back once the writes are committed. */
  readonly result: CreateProjectResult;
}

// The lexicon's limits on a Collection's `items` and on an item's `itemWeight`. They are checked
// here, before any read, so that the message names `activities` and `weight` as the caller passed
// them, not the `items` and `itemWeight` the record build would name after the reads.
const MAX_ACTIVITIES = 1000;
const MAX_WEIGHT_LENGTH = 100;

// `type` and `items` are not fields of a Project, so they are refused with a message that says what
// to do, before the schema's general "unknown field".
const REFUSED_FIELDS = {
  type: 'a Project always has type "project". To create a Collection of another type, use createCollection from @hypercerts-org/sdk/collection',
  items:
    "a Project lists its Activities in `activities`: { activity } for a new Activity or { uri } of an existing one. To add Features or child Collections, use createCollection from @hypercerts-org/sdk/collection",
} as const;

// What a Project takes from `CollectionInput` is passed on to `planCollection`, which checks it. The
// list is here so that a misspelled field is reported with the Project's own fields, and
// `satisfies` fails to compile when `ProjectInput` gains a field this list lacks.
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

const activityEntry = strictObject({
  activity: l.optional(l.unknown()),
  uri: l.optional(l.string()),
  weight: l.optional(
    l.refine(weightString, {
      check: (value: string) => value.length <= MAX_WEIGHT_LENGTH,
      message: `must be at most ${MAX_WEIGHT_LENGTH} characters`,
    }),
  ),
});

// What the Activity a Project without `activities` copies from the Project: the Activity's own text
// fields, and the banner, which becomes its image.
const copiedFields = l.object({ ...activityTextFields, banner: optionalMedia });

// The copied text fields, typed as the Activity's input has them, which the schema leaves unknown.
type CopiedText = Omit<l.InferOutput<typeof copiedFields>, "banner" | "shortDescriptionFacets"> &
  Pick<ActivityInput, "shortDescriptionFacets">;

// An Activity's `image` is a `smallImage` (5 MiB), a Project's `banner` a `largeImage` (10 MiB), and
// the two accept the same image types, so a banner can only be too large for the Activity.
const ACTIVITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Validates the input of a Project, reads what it points at, uploads its files and prepares every
 * record it creates: the Project, its Activities (or the default one) and their supporting
 * records, the Project last.
 *
 * Internal. `createProject` submits the result as it is. The Project is planned by
 * `planCollection` as a Collection of type `project` whose items are the entries of `activities`,
 * and prepared in the order `createCollection` uses: input checks, then reads, then uploads.
 *
 * Throws TypeError, naming the field, for any problem in the input, and what `prepareSlots` throws.
 */
export async function prepareProject(
  build: BuildContext,
  value: unknown,
): Promise<PreparedProject> {
  const { collection, hasDefaultActivity } = readProject(build, value);
  try {
    const planned = planCollection(build, "input", collection);
    // Reads first, then uploads: a URI that cannot be resolved, or a taken tag key, fails before
    // anything is uploaded.
    const { created, refOf } = await prepareSlots(build, [planned.slot], { checkKeys: true });
    return {
      writes: [...created.values()],
      result: projectResult(planned.result(created, refOf)),
    };
  } catch (error) {
    throw nameActivities(error, hasDefaultActivity);
  }
}

// The Project as the input of a Collection: type `project`, and its Activities (or the default one)
// as items. Everything about `activities` is checked here, under the names the caller used.
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
  const { activity: data, uri, weight } = parseInput(build, field, activityEntry, value);
  if ((data === undefined) === (uri === undefined)) {
    throw new TypeError(
      `${build.operation}: ${field} must have exactly one of activity or uri, but has ${data === undefined ? "none" : "both"}. Use { activity } with the data of a new Activity, or { uri } of an existing one, and an optional weight.`,
    );
  }
  if (uri === undefined) return { activity: data, weight };
  // An item of a Collection may be a Feature or a Collection, so `planCollection` would accept
  // them. The slot is only made to check the type here; `planCollection` plans the entry again.
  toExistingSlot(build, `${field}.uri`, { uri }, [activity.main.$type]);
  return { uri, weight };
}

// The Activity a Project without `activities` gets: it copies the Project's title, shortDescription,
// shortDescriptionFacets, description and langs, and its banner as the image, and nothing else. A
// value that does not fit is an error, never shortened; only a banner that is too large for the
// Activity is left out, because the Project holds it anyway. The Project's own limits are checked
// first, so that a value the Project rejects is reported as the Project's problem, and "pass
// `activities`" is only said for what the Project accepts and the Activity does not (its title is
// tighter).
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

// Checks the copied fields against both lexicons, the Project's first, with what can be checked
// before anything is read or uploaded: a `{ uri }` description needs the CID that is read later, and
// a file the CID that its upload returns.
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

// A URL is copied as it is. A file is copied only when the Activity can hold it. A larger banner is
// left out of the Activity, not an error: the Project stores it as its banner all the same.
function activityImage(build: BuildContext, banner: Blob | string | undefined) {
  if (banner === undefined || typeof banner === "string") return banner;
  // The Project's own rule first, so that a file its banner cannot be is reported as `input.banner`
  // before anything is uploaded, not as the Activity's image.
  assertWithinLimits(build, "input.banner", banner, "largeImage");
  return banner.size <= ACTIVITY_IMAGE_MAX_BYTES ? banner : undefined;
}

// A string or Leaflet description as a record stores it. A `{ uri }` has no such value: it is stored
// as a strong reference once its record is read.
function inlineDescription(description: string | LeafletDocument | ExistingRecord | undefined) {
  if (isExistingRecord(description)) return undefined;
  return typeof description === "string"
    ? defs.descriptionString.build({ value: description })
    : description;
}

// `planCollection` names an entry `input.items[i]`, because to it the entries are items. The caller
// wrote `activities`, so the messages are changed to name what the caller passed. The default
// Activity's image is the Project's banner, which is what the caller passed.
function nameActivities(error: unknown, hasDefaultActivity: boolean): unknown {
  if (error instanceof Error) {
    const message = hasDefaultActivity
      ? error.message.replaceAll("input.items[0].activity.image", "input.banner")
      : error.message;
    error.message = message.replaceAll("input.items[", "input.activities[");
  }
  return error;
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
