import { l, type RecordKeyString } from "@atproto/lex";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import {
  type ActivityEntryResult,
  entryWeight,
  planActivityEntry,
} from "../activity/activity-entry.js";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  describeWrittenRepo,
  parseInput,
} from "../internal/build-context.js";
import { describeError } from "../internal/describe.js";
import { compact, strictObject } from "../internal/input.js";
import { type PreparedRecord, prepareUpdate } from "../internal/prepare-record.js";
import {
  assertRecordUriOfType,
  parseRecordUri,
  readRecord,
  type StoredRecord,
  type StrongRef,
} from "../internal/resolve-record-ref.js";
import { prepareSlots } from "../internal/slots.js";
import { submitWrites } from "../internal/submit-writes.js";
import type { WriteOptions } from "../write-options.js";

// The `maxLength` of the lexicon's `items`. Only used to explain a full Collection in plain words:
// validating the updated record against the lexicon still decides what is valid.
const MAX_ITEMS = 1000;

const collectionRef = strictObject({ uri: l.string() });

/**
 * How one public operation names the Collection it adds to, and what else it requires of it.
 *
 * `addActivityToCollection` and `addActivityToProject` do the same work; they differ in
 * the words of their messages and in the Project's check of the Collection's `type`.
 */
interface AddActivityTarget {
  /** The input field that holds the `{ uri }`, as the caller wrote it: "collection" or "project". */
  readonly field: string;
  /** What the record is called in messages: "Collection" or "Project". */
  readonly noun: string;
  /**
   * Refuses a stored Collection this operation does not take: throws a TypeError that says what to
   * do instead. Runs on both reads of the Collection, because only the second is guarded.
   */
  readonly check?: (stored: collection.Main, uri: string) => void;
}

/**
 * Adds one Activity, new or existing, to a Collection in the signed-in account's repo, in one atomic
 * write guarded against a concurrent change to the Collection.
 *
 * Order, so that a mistake costs as little as possible:
 * 1. the URI and the entry are checked, with no request;
 * 2. the Collection is read and checked, so a missing, invalid or full one fails before any upload;
 * 3. an existing Activity is read and blobs are uploaded (see `prepareSlots`);
 * 4. with new records to create, the repository's head is read, then the Collection again, which is
 *    the read `swapCommit` guards: a write that lands between the head and the second read moves the
 *    head and fails the request, and one before the head is part of the Collection that was read.
 *    With an existing Activity only, there is no head: the Collection is read, and its CID is the
 *    `swapRecord` of the write;
 * 5. new records and the Collection go in one `applyWrites`; the Collection alone in one `putRecord`
 *    with `swapRecord`, which other writes to the account do not fail.
 *
 * Throws TypeError for input the caller must change, Error for anything unreadable or a Collection
 * that cannot take the item, and what `submitWrites` throws.
 */
export async function addActivity(
  context: SDKContext,
  operation: string,
  target: AddActivityTarget,
  input: unknown,
  options?: WriteOptions,
): Promise<StrongRef & { activity: ActivityEntryResult }> {
  const build = createBuildContext(context, operation, options);
  const { uri, activity: activityValue, weight } = parseAddInput(build, target.field, input);
  const rkey = parseCollectionUri(build, target, uri);
  const planned = planActivityEntry(build, "input.activity", activityValue);
  checkCollection(build, target, await readRecord(context, uri, build.operation));

  // The records that need the network are read as late as possible, to keep the window in which
  // another write can slip in small. The head comes first: see `WriteTarget.readHead`.
  const { created, refOf } = await prepareSlots(build, [planned.slot], {
    checkKeys: true,
    // The Collection update goes in the same request.
    otherWrites: 1,
  });
  // Only a request that also creates records needs the whole repo's head: it is one `applyWrites`,
  // which has no per-record check. An update alone is guarded by the Collection's own CID.
  const head = created.size === 0 ? undefined : await build.target.readHead();
  const stored = await readRecord(context, uri, build.operation);
  const item = compact({ itemIdentifier: refOf(planned.slot), itemWeight: weight });
  const updated = await appendItem(build, target, stored, rkey, item);

  await submitWrites(build, [...created.values()], {
    updates: [{ record: updated, swapRecord: stored.ref.cid, noun: target.noun }],
    swapCommit: head,
  });
  return { ...updated.ref, activity: planned.result(created, refOf) };
}

// The input of both public operations, which differ only in the name of the field that holds the
// Collection's `{ uri }`: that, the Activity (checked by `planActivityEntry`) and the weight of its
// item.
function parseAddInput(build: BuildContext, field: string, input: unknown) {
  const shape: Record<string, l.Validator> = {
    [field]: l.unknown(),
    activity: l.unknown(),
    weight: entryWeight,
  };
  const parsed = parseInput(build, "input", strictObject(shape), input);
  const { uri } = parseInput(build, `input.${field}`, collectionRef, parsed[field]);
  return { uri, activity: parsed.activity, weight: parsed.weight as string | undefined };
}

// Checked before any request: the URI must name a Collection in the signed-in account's repo.
function parseCollectionUri(
  build: BuildContext,
  { field, noun }: AddActivityTarget,
  uri: string,
): RecordKeyString {
  const parsed = parseRecordUri(uri, build.operation);
  assertRecordUriOfType(
    build.operation,
    `${field}.uri`,
    uri,
    [collection.main.$type],
    `it must be of type ${collection.main.$type}`,
  );
  if (parsed.did !== build.did) {
    throw new TypeError(
      `${build.operation}: ${field}.uri is in the repository of ${parsed.did}, but this operation writes to ${describeWrittenRepo(build)} and changes only that repository's own ${noun}s: ${uri}.`,
    );
  }
  return parsed.rkey;
}

type Item = NonNullable<collection.Main["items"]>[number];

// The Collection as it will be written: the stored record with `item` added at the end of `items`
// and everything else untouched.
async function appendItem(
  build: BuildContext,
  target: AddActivityTarget,
  stored: StoredRecord,
  rkey: RecordKeyString,
  item: Item,
): Promise<PreparedRecord> {
  const current = checkCollection(build, target, stored);
  const items = current.items ?? [];
  try {
    // The whole record again, under the key it already has: this prepares an update, not a create.
    return await prepareUpdate(
      build.did,
      collection.main,
      { ...current, items: [...items, item] },
      rkey,
    );
  } catch (error) {
    throw new TypeError(
      `${build.operation}: the updated ${target.noun} is not a valid ${collection.main.$type} record: ${describeError(error)}. No record was written.`,
      { cause: error },
    );
  }
}

// The stored Collection, when it is valid, the operation accepts it, and it has room for one more
// item.
function checkCollection(
  build: BuildContext,
  target: AddActivityTarget,
  stored: StoredRecord,
): collection.Main {
  const { uri } = stored.ref;
  const { noun } = target;
  const current = collection.main.safeValidate(stored.value);
  if (!current.success) {
    throw new Error(
      `${build.operation}: the ${noun} ${uri} is not a valid ${collection.main.$type} record (${describeError(current.reason)}), so the SDK does not change it. No record was written.`,
      { cause: current.reason },
    );
  }
  target.check?.(current.value, uri);
  const items = current.value.items ?? [];
  if (items.length >= MAX_ITEMS) {
    throw new Error(
      `${build.operation}: the ${noun} ${uri} already lists ${items.length} items, the most a ${noun} can hold (${MAX_ITEMS}). No record was written.`,
    );
  }
  return current.value;
}
