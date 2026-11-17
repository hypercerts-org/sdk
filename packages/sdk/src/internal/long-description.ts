import { l } from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import * as linearDocument from "@hypercerts-org/lexicon/pub/leaflet/pages/linearDocument";
import { type BuildContext, parseInput } from "./build-context.js";
import type { FieldTransform, ReferenceField } from "./record-kind.js";
import {
  type ExistingRecord,
  isExistingRecord,
  type ReferenceOf,
  type Slot,
  toExistingSlot,
} from "./slots.js";

/**
 * A Leaflet document (`pub.leaflet.pages.linearDocument`): rich text in blocks. Passed to the record
 * as it is; the lexicon validates it.
 */
export type LeafletDocument = l.$Typed<linearDocument.Main>;

const isLeafletDocument = (value: unknown): value is LeafletDocument =>
  typeof value === "object" &&
  value !== null &&
  "$type" in value &&
  value.$type === linearDocument.$type;

/**
 * The input schema of a long description: a string, a Leaflet document with its `$type`, or `{ uri }`
 * of an existing record.
 *
 * Internal. For lexicon fields that are the union of `org.hypercerts.defs#descriptionString`,
 * `pub.leaflet.pages.linearDocument` and `com.atproto.repo.strongRef` (a Feature's `description`, an
 * organization's `longDescription`). Use it with `longDescriptionTransform` and
 * `longDescriptionReference`, which turn each of the three into the stored value.
 */
export const longDescription = l.custom<string | LeafletDocument | ExistingRecord>(
  (value): value is string | LeafletDocument | ExistingRecord =>
    typeof value === "string" || isExistingRecord(value) || isLeafletDocument(value),
  `must be a string, { uri } of an existing record, or a Leaflet document with $type "${linearDocument.$type}"`,
);

/**
 * The `recordKind` transform of a long description: a string becomes `descriptionString`, and a
 * Leaflet document is kept as it is. A reference arrives here already stored with its `$type` (see
 * `longDescriptionReference`) and is kept too.
 */
export const longDescriptionTransform: FieldTransform = (_build, _field, value: string | object) =>
  Promise.resolve(typeof value === "string" ? defs.descriptionString.build({ value }) : value);

/**
 * The `recordKind` reference spec of a long description. Only `{ uri }` is a reference, to a record
 * of any type. The field's union has the strong reference as a member, so it is stored with its
 * `$type`.
 */
export const longDescriptionReference: ReferenceField = {
  kind: undefined,
  many: false,
  when: isExistingRecord,
  typed: true,
};

/**
 * Plans the `description` of a record built by hand: the slot of the existing record for `{ uri }`,
 * `undefined` for a string, a Leaflet document or no value.
 *
 * Internal. Pair it with `longDescriptionValue`. Throws TypeError, naming `field`, for any other
 * value.
 */
export function planLongDescription(
  build: BuildContext,
  field: string,
  value: unknown,
): Slot | undefined {
  if (value === undefined) return undefined;
  const description = parseInput(build, field, longDescription, value);
  return isExistingRecord(description) ? toExistingSlot(build, field, description) : undefined;
}

/**
 * The value a record stores for a description planned by `planLongDescription`: `descriptionString`
 * for a string, the strong reference (with its `$type`) for `{ uri }`, a Leaflet document as it is.
 *
 * Internal. `existing` is the slot `planLongDescription` returned.
 */
export function longDescriptionValue(
  description: unknown,
  existing: Slot | undefined,
  refOf: ReferenceOf,
) {
  if (existing !== undefined) return strongRef.main.build(refOf(existing));
  return typeof description === "string"
    ? defs.descriptionString.build({ value: description })
    : (description as LeafletDocument);
}
