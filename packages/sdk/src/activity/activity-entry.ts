import { l } from "@atproto/lex";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import { type BuildContext, parseInput } from "../internal/build-context.js";
import { strictObject, weightString } from "../internal/input.js";
import {
  type ResultOf,
  type Slot,
  type SupportingRecordRef,
  toExistingSlot,
} from "../internal/slots.js";
import {
  type ActivityInput,
  type CreateActivityResult,
  planActivitySlot,
} from "./build-activity.js";

/**
 * An Activity to put in a Collection or Project: exactly one of `{ activity }` (a new Activity) or
 * `{ uri }` (an existing Activity, reused and never changed). A bare Activity is not an entry.
 */
export type ActivityEntry =
  | {
      /** A new Activity and its supporting records. See {@link ActivityInput}. */
      activity: ActivityInput;
      uri?: never;
    }
  | {
      /** An existing Activity: `at://<did>/org.hypercerts.claim.activity/<rkey>`, with a DID. */
      uri: string;
      activity?: never;
    };

/**
 * What a call did for one {@link ActivityEntry}: created the Activity (with its records) or reused
 * it. Narrow on `created`.
 */
export type ActivityEntryResult =
  | (CreateActivityResult & { created: true })
  | (SupportingRecordRef & { created: false });

const MAX_WEIGHT_LENGTH = 100;

/**
 * The schema of the optional weight of an entry: a positive decimal string of at most the 100
 * characters the lexicon allows, checked here so the message names `weight` as the caller wrote it.
 *
 * Internal.
 */
export const entryWeight = l.optional(
  l.refine(weightString, {
    check: (value: string) => value.length <= MAX_WEIGHT_LENGTH,
    message: `must be at most ${MAX_WEIGHT_LENGTH} characters`,
  }),
);

/**
 * The schemas of an entry's two choices, for an input that adds more fields (a weight) around them.
 *
 * Internal.
 */
export const activityEntryFields = {
  activity: l.optional(l.unknown()),
  uri: l.optional(l.string()),
};

const activityEntry = strictObject(activityEntryFields);

/**
 * Checks that exactly one of `activity` and `uri` is given.
 *
 * Internal. `field` names the entry in messages. The choice is explicit and never guessed from the
 * fields, so a bare Activity (`{ title, shortDescription }`) fails on its unknown fields first.
 *
 * Throws TypeError, naming `field`, when both or neither is given.
 */
export function chooseActivity(
  build: BuildContext,
  field: string,
  entry: { activity?: unknown; uri?: string | undefined },
): { activity: unknown } | { uri: string } {
  const { uri } = entry;
  if (uri !== undefined && entry.activity === undefined) return { uri };
  if (uri === undefined && entry.activity !== undefined) return { activity: entry.activity };
  throw new TypeError(
    `${build.operation}: ${field} must have exactly one of activity or uri, but has ${uri === undefined ? "none" : "both"}. Use { activity } with the data of a new Activity, or { uri } of an existing one.`,
  );
}

/**
 * The slot of an existing Activity: `uri` must name an Activity (not a Feature or a Collection) and
 * use a DID.
 *
 * Internal. Throws TypeError, naming `field.uri`, for any other URI.
 */
export const existingActivitySlot = (build: BuildContext, field: string, uri: string): Slot =>
  toExistingSlot(build, `${field}.uri`, { uri }, [activity.main.$type]);

/** An entry planned: nothing is read, uploaded or written yet. */
export interface PlannedActivityEntry {
  /** The Activity to create, or the existing one to read for its CID. */
  readonly slot: Slot;
  /** What the caller gets back for the entry once its records are prepared. */
  readonly result: ResultOf<ActivityEntryResult>;
}

/**
 * Validates an {@link ActivityEntry} and plans its Activity, without sending any request.
 *
 * Internal. `field` names the entry in messages, for example `input.activity`, and the data of a new
 * Activity as `input.activity.activity`. Throws TypeError, naming the field, for any problem in it.
 */
export function planActivityEntry(
  build: BuildContext,
  field: string,
  value: unknown,
): PlannedActivityEntry {
  const choice = chooseActivity(build, field, parseInput(build, field, activityEntry, value));
  if ("uri" in choice) {
    const slot = existingActivitySlot(build, field, choice.uri);
    return { slot, result: (_created, refOf) => ({ ...refOf(slot), created: false }) };
  }
  const planned = planActivitySlot(build, choice.activity, `${field}.activity`);
  return {
    slot: planned.slot,
    result: (created, refOf) => ({ ...planned.result(created, refOf), created: true }),
  };
}
