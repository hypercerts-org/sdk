import { l } from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import * as feature from "@hypercerts-org/lexicon/org/hypercerts/entity/feature";
import {
  type ActivityInput,
  type CreateActivityResult,
  planActivitySlot,
} from "../activity/build-activity.js";
import {
  type CreateFeatureResult,
  type FeatureInput,
  type FeatureTree,
  featureKind,
  featureResult,
  type LeafletDocument,
} from "../feature/build-feature.js";
import { type BuildContext, parseInput } from "../internal/build-context.js";
import { longDescription } from "../internal/long-description.js";
import {
  compact,
  optionalMedia,
  optionalText,
  strictObject,
  weightString,
} from "../internal/input.js";
import { mediaTransform } from "../internal/media.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import { buildRecord, recordKind } from "../internal/record-kind.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import {
  type ExistingRecord,
  isExistingRecord,
  type NewSlot,
  planNew,
  type ReferenceOf,
  recordRef,
  resultOf,
  type Slot,
  type SupportingRecordRef,
  toExistingSlot,
  toSlot,
} from "../internal/slots.js";
import { type LocationInput, locationKind } from "../location/build-location.js";
import {
  type VocabularyTagInput,
  type VocabularyTagResult,
  vocabularyTagKind,
} from "../tag/build-tag.js";

/**
 * One item of a new Collection: exactly one of `activity`, `feature`, `collection` or `uri`, with an
 * optional `weight`.
 *
 * @remarks
 * The choice is explicit and never guessed from the fields: the data of a new Activity, Feature
 * or Collection goes under `activity`, `feature` or `collection`, and an existing record under
 * `uri`. A bare Activity (`{ title, shortDescription }`) is not an item. An existing record is
 * reused as it is and never changed; it must be an Activity, a Feature or a Collection.
 */
export type CollectionItemInput = {
  /**
   * The weight of the item in the Collection, a positive decimal number written as a string (for
   * example `"2"` or `"0.5"`). Weights need not add up to anything; consumers normalise them. The
   * string is stored as written. At most 100 characters. Left out of the item when not set.
   */
  weight?: string | undefined;
} & (
  | {
      /** A new Activity and its supporting records. See {@link ActivityInput}. */
      activity: ActivityInput;
      feature?: never;
      collection?: never;
      uri?: never;
    }
  | {
      /** A new Feature and its tags and locations. See {@link FeatureInput}. */
      feature: FeatureInput;
      activity?: never;
      collection?: never;
      uri?: never;
    }
  | {
      /** A new child Collection, which can have items of its own. See {@link CollectionInput}. */
      collection: CollectionInput;
      activity?: never;
      feature?: never;
      uri?: never;
    }
  | {
      /**
       * An existing Activity, Feature or Collection as `at://<did>/<collection>/<rkey>`, identified
       * by a DID, not a handle. It may belong to another account if it is public.
       */
      uri: string;
      activity?: never;
      feature?: never;
      collection?: never;
    }
);

/** The data of a new `org.hypercerts.collection` record and the records it needs. */
export interface CollectionInput {
  /** The display name. At most 800 characters and 80 graphemes. */
  title: string;
  /**
   * The kind of Collection: `favorites`, `project`, `portfolio` or `program`. Other values are
   * accepted. At most 64 characters.
   */
  type?: string | undefined;
  /** A summary for previews, at most 3000 characters and 300 graphemes. */
  shortDescription?: string | undefined;
  /**
   * Rich-text annotations (mentions, links, hashtags) of `shortDescription`, as
   * `app.bsky.richtext.facet` objects. Passed to the record as given; the lexicon validates them.
   */
  shortDescriptionFacets?: collection.Main["shortDescriptionFacets"];
  /**
   * A long description: plain text, a {@link LeafletDocument}, or `{ uri }` of an existing record
   * of any type, stored as a reference to it. A string and a document are stored inline, as they
   * are (a document needs its `$type`). The SDK never creates a document record.
   */
  description?: string | LeafletDocument | ExistingRecord | undefined;
  /** Languages of the text fields as BCP-47 tags (up to three), for example `["en"]`. */
  langs?: readonly string[] | undefined;
  /**
   * The avatar: an image `Blob` or `File` (JPEG, PNG or WebP, up to 5 MB) that the SDK uploads, or
   * a URL string that is stored as it is.
   */
  avatar?: Blob | string | undefined;
  /**
   * The banner behind the Collection's view: an image `Blob` or `File` (JPEG, PNG or WebP, up to
   * 10 MB) that the SDK uploads, or a URL string that is stored as it is.
   */
  banner?: Blob | string | undefined;
  /** Where the Collection's work happened: the data of a new location or `{ uri }` of an existing one. */
  location?: LocationInput | ExistingRecord | undefined;
  /**
   * The vocabulary tags that classify the Collection, at most 20: each entry is the data of a new
   * vocabulary tag, which gets the record key `<category>.<key>`, or `{ uri }` of an existing one.
   */
  tags?: readonly (VocabularyTagInput | ExistingRecord)[] | undefined;
  /** The items, in the order they are stored, at most 1000. See {@link CollectionItemInput}. */
  items?: readonly CollectionItemInput[] | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/** The kinds of record an item can be. */
export type CollectionItemType = "activity" | "feature" | "collection";

/**
 * What a {@link createCollection} call did for one item, in the order of the input: whether it
 * created the record (`created`) and which kind of record it is (`type`). For a new item the
 * result also holds what the call created for it: narrow on `created` and `type`.
 */
export type CreateCollectionItemResult =
  | (CreateActivityResult & { type: "activity"; created: true })
  | (CreateFeatureResult & { type: "feature"; created: true })
  | (CreateCollectionResult & { type: "collection"; created: true })
  | (SupportingRecordRef & { type: CollectionItemType; created: false });

/**
 * The result of {@link createCollection}.
 *
 * @remarks
 * `items[i]` and `tags[i]` belong to the input entry at the same index, whether it was created or
 * reused. Filter on `created` for only the records this call wrote.
 */
export interface CreateCollectionResult {
  /** The URI of the new Collection. */
  uri: StrongRef["uri"];
  /** The CID of the new Collection. */
  cid: StrongRef["cid"];
  /** The location, when the input had `location`. */
  location?: SupportingRecordRef;
  /** The vocabulary tags, in input order. */
  tags: readonly VocabularyTagResult[];
  /** The items, in input order. */
  items: readonly CreateCollectionItemResult[];
}

/** A Collection and every record it needs, planned: nothing is read, uploaded or written yet. */
export interface PlannedCollection {
  /** The Collection as a record to create. Everything it points at is a reference of the slot. */
  readonly slot: NewSlot;
  /** What the caller gets back for the Collection once its records are prepared. */
  readonly result: (
    created: ReadonlyMap<Slot, PreparedRecord>,
    refOf: ReferenceOf,
  ) => CreateCollectionResult;
}

// The choices of `description`, `location`, `tags` and `items` are read below, where what each may
// hold is known, so the schema only says where they are. The stored value of an item is not the
// input's, so the record is built by hand from the plan and `buildRecord` only completes it.
const collectionKind = recordKind(
  collection.main,
  {
    type: optionalText,
    title: l.string(),
    shortDescription: optionalText,
    shortDescriptionFacets: l.optional(l.array(l.unknown())),
    description: l.optional(l.unknown()),
    langs: l.optional(l.array(l.string())),
    avatar: optionalMedia,
    banner: optionalMedia,
    location: l.optional(l.unknown()),
    tags: l.optional(l.array(l.unknown())),
    items: l.optional(l.array(l.unknown())),
  },
  { avatar: mediaTransform("image"), banner: mediaTransform("largeImage") },
);

const itemInput = strictObject({
  activity: l.optional(l.unknown()),
  feature: l.optional(l.unknown()),
  collection: l.optional(l.unknown()),
  uri: l.optional(l.string()),
  weight: l.optional(weightString),
});

const ITEM_CHOICES = ["activity", "feature", "collection", "uri"] as const;

// The record types an existing item may have.
const ITEM_COLLECTIONS = [activity.main.$type, feature.main.$type, collection.main.$type] as const;
const ITEM_TYPES = {
  [activity.main.$type]: "activity",
  [feature.main.$type]: "feature",
  [collection.main.$type]: "collection",
} as const satisfies Record<(typeof ITEM_COLLECTIONS)[number], CollectionItemType>;

interface PlannedItem {
  readonly slot: Slot;
  readonly weight: string | undefined;
  readonly result: (
    created: ReadonlyMap<Slot, PreparedRecord>,
    refOf: ReferenceOf,
  ) => CreateCollectionItemResult;
}

/**
 * Validates the input of a Collection and plans it and every record it needs, at any depth,
 * without sending any request, so every problem in the data is found before the first one.
 *
 * Internal. `field` names the data in messages, for example `input` gives `input.items[0].uri`.
 * New child records are planned with their own record families' builders: Activities with
 * `planActivitySlot`, Features with `featureKind`, child Collections with this function.
 *
 * Throws TypeError, naming the field, for any problem in the data.
 */
export function planCollection(
  build: BuildContext,
  field: string,
  value: unknown,
): PlannedCollection {
  // Hand-written instead of a `recordKind` with `references`: an item stores a strong reference plus
  // a weight, which a reference field (a plain list of strong references) cannot express.
  const plan = planFields(build, field, value);
  const slot: NewSlot = {
    collection: collection.main.$type,
    field,
    choice: {
      kind: "new",
      key: undefined,
      references: compact({
        description: plan.description,
        location: plan.location,
        tags: plan.tags,
        items: plan.items?.map((item) => item.slot),
      }),
      prepare: (refOf) => buildRecord(collectionKind, build, storedFields(plan, refOf), field),
    },
  };
  return {
    slot,
    result: (created, refOf) => ({
      ...refOf(slot),
      ...compact({ location: plan.location && recordRef(plan.location, created, refOf) }),
      tags: (plan.tags ?? []).map((tag) => resultOf<VocabularyTagResult>(tag, created, refOf)),
      items: (plan.items ?? []).map((item) => item.result(created, refOf)),
    }),
  };
}

interface CollectionPlan {
  readonly input: l.InferOutput<typeof collectionKind.input>;
  /** The existing record of a `{ uri }` description. */
  readonly description: Slot | undefined;
  readonly location: Slot | undefined;
  readonly tags: readonly Slot[] | undefined;
  readonly items: readonly PlannedItem[] | undefined;
}

function planFields(build: BuildContext, field: string, value: unknown): CollectionPlan {
  const input = parseInput(build, field, collectionKind.input, value);
  return {
    input,
    description: planDescription(build, `${field}.description`, input.description),
    location:
      input.location === undefined
        ? undefined
        : toSlot(build, `${field}.location`, input.location, locationKind, false),
    tags: input.tags?.map((tag, i) =>
      toSlot(build, `${field}.tags[${i}]`, tag, vocabularyTagKind, false),
    ),
    items: input.items?.map((item, i) => planItem(build, `${field}.items[${i}]`, item)),
  };
}

// The input with each field that holds records replaced by what is stored for it.
function storedFields(
  { input, description, location, tags, items }: CollectionPlan,
  refOf: ReferenceOf,
) {
  return {
    ...input,
    ...compact({
      description: descriptionValue(input.description, description, refOf),
      location: location && refOf(location),
      tags: tags?.map(refOf),
      items: items?.map((item) =>
        compact({ itemIdentifier: refOf(item.slot), itemWeight: item.weight }),
      ),
    }),
  };
}

// Only `{ uri }` is a record. A string and a Leaflet document are stored in the Collection itself.
function planDescription(build: BuildContext, field: string, value: unknown): Slot | undefined {
  if (value === undefined) return undefined;
  const description = parseInput(build, field, longDescription, value);
  return isExistingRecord(description) ? toExistingSlot(build, field, description) : undefined;
}

// The union of the lexicon's `description` has the strong reference as a member, so a reference is
// stored with its `$type`.
function descriptionValue(description: unknown, existing: Slot | undefined, refOf: ReferenceOf) {
  if (existing !== undefined) return strongRef.main.build(refOf(existing));
  return typeof description === "string"
    ? defs.descriptionString.build({ value: description })
    : description;
}

function planItem(build: BuildContext, field: string, value: unknown): PlannedItem {
  const item = parseInput(build, field, itemInput, value);
  const given = ITEM_CHOICES.filter((choice) => item[choice] !== undefined);
  if (given.length !== 1) {
    throw new TypeError(
      `${build.operation}: ${field} must have exactly one of activity, feature, collection or uri, but has ${given.length === 0 ? "none" : given.join(" and ")}. Use { activity }, { feature } or { collection } with the data of a new record, or { uri } of an existing one, and an optional weight.`,
    );
  }
  // `uri` first: it is the only choice the schema types, the rest are planned by their builders.
  const target =
    item.uri !== undefined
      ? existingItem(build, `${field}.uri`, item.uri)
      : planNewItem(build, field, item);
  return { ...target, weight: item.weight };
}

function planNewItem(
  build: BuildContext,
  field: string,
  item: l.InferOutput<typeof itemInput>,
): Omit<PlannedItem, "weight"> {
  if (item.activity !== undefined) {
    const planned = planActivitySlot(build, item.activity, `${field}.activity`);
    return {
      slot: planned.slot,
      result: (created, refOf) => ({
        ...planned.result(created, refOf),
        type: "activity",
        created: true,
      }),
    };
  }
  if (item.feature !== undefined) {
    const slot = planNew(build, `${field}.feature`, featureKind, item.feature);
    return {
      slot,
      result: (created, refOf) => ({
        ...featureResult(resultOf<FeatureTree>(slot, created, refOf)),
        type: "feature",
        created: true,
      }),
    };
  }
  const child = planCollection(build, `${field}.collection`, item.collection);
  return {
    slot: child.slot,
    result: (created, refOf) => ({
      ...child.result(created, refOf),
      type: "collection",
      created: true,
    }),
  };
}

function existingItem(
  build: BuildContext,
  field: string,
  uri: string,
): Omit<PlannedItem, "weight"> {
  const slot = toExistingSlot(build, field, { uri }, ITEM_COLLECTIONS);
  const type = ITEM_TYPES[slot.collection];
  return { slot, result: (_created, refOf) => ({ ...refOf(slot), type, created: false }) };
}
