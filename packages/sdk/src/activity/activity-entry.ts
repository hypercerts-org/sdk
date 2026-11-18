import { l } from "@atproto/lex";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import type { BuildContext } from "../internal/build-context.js";
import { WEIGHT_MAX_LENGTH, weightString } from "../internal/input.js";
import {
  isExistingRecord,
  type Planned,
  type Slot,
  type SupportingRecordRef,
  toExistingSlot,
} from "../internal/slots.js";
import { type CreateActivityResult, planActivitySlot } from "./create-activity.js";

/**
 * What a call did for one Activity that may be new or existing: created the Activity (with its records) or reused
 * it. Narrow on `created`.
 */
export type ActivityEntryResult =
  | (CreateActivityResult & { created: true })
  | (SupportingRecordRef & { created: false });

/**
 * The schema of the optional weight of an entry (a collection item or project activity).
 */
export const entryWeight = l.optional(weightString(WEIGHT_MAX_LENGTH));

/**
 * The slot of an existing Activity: `value` is `{ uri }`, and the URI must name an Activity (not a
 * Feature or a Collection) and use a DID.
 *
 * Throws TypeError, naming `field.uri`, for any other URI.
 */
export const existingActivitySlot = (build: BuildContext, field: string, value: unknown): Slot =>
  toExistingSlot(build, `${field}.uri`, value, [activity.main.$type]);

/**
 * Validates an Activity given as the data of a new one or as `{ uri }` of an existing one, and plans
 * it, without sending any request.
 *
 * `field` names the Activity in messages, for example `input.activity`. Throws TypeError,
 * naming the field, for any problem in it.
 */
export function planActivityEntry(
  build: BuildContext,
  field: string,
  value: unknown,
): Planned<ActivityEntryResult> {
  if (isExistingRecord(value)) {
    const slot = existingActivitySlot(build, field, value);
    return { slot, result: (_created, refOf) => ({ ...refOf(slot), created: false }) };
  }
  const planned = planActivitySlot(build, value, field);
  return {
    slot: planned.slot,
    result: (created, refOf) => ({ ...planned.result(created, refOf), created: true }),
  };
}
