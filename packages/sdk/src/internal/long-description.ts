import { l } from "@atproto/lex";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import * as linearDocument from "@hypercerts-org/lexicon/pub/leaflet/pages/linearDocument";
import type { FieldTransform, ReferenceField } from "./record-kind.js";
import { type ExistingRecord, isExistingRecord } from "./slots.js";

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
