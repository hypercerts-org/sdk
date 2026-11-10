import { l } from "@atproto/lex";
import * as measurement from "@hypercerts-org/lexicon/org/hypercerts/context/measurement";
import { dateRange, optionalText } from "../internal/input.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";
import type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
import type { LocationInput } from "../location/build-location.js";
import {
  creatorOf,
  decimalString,
  didListInput,
  didListTransform,
  existingRecordsReference,
  locationsReference,
} from "./shared.js";

/** The data of a new `org.hypercerts.context.measurement` record. */
export interface MeasurementInput {
  /** The metric being measured, for example `Forest area restored`. At most 500 characters. */
  metric: string;
  /** The unit of `value`, for example `hectares`, `kg CO₂e` or `%`. At most 50 characters. */
  unit: string;
  /**
   * The measured value as a decimal number written as a string, for example `"1234.56"` or `"-3"`.
   * At most 500 characters. A JavaScript number is rejected, not converted, so no precision is
   * lost; exponent notation (`"1e3"`) and thousands separators (`"1,234"`) are rejected too.
   */
  value: string;
  /**
   * The records the measurement is about, at most 100, each `{ uri }` of an existing record of any
   * type (an Activity, a Collection, a Feature, ...). Pinned by the CID read before the write and
   * never modified.
   */
  subjects?: readonly ExistingRecord[] | undefined;
  /** An ISO 8601 date-time: when the measurement began. */
  startDate?: string | undefined;
  /**
   * An ISO 8601 date-time, not before `startDate`: when the measurement ended. For a one-time
   * measurement the lexicon asks for the same value as `startDate`.
   */
  endDate?: string | undefined;
  /**
   * Where the measurement was taken, at most 100: each entry is the data of a new location or
   * `{ uri }` of an existing one.
   */
  locations?: readonly (LocationInput | ExistingRecord)[] | undefined;
  /** A short identifier for the methodology. At most 30 characters. */
  methodType?: string | undefined;
  /** A URI to the methodology documentation, standard or procedure. Stored as written, never fetched. */
  methodURI?: string | undefined;
  /** URIs to evidence or the underlying data, at most 50. Stored as written, never fetched. */
  evidenceURI?: readonly string[] | undefined;
  /**
   * DIDs of the entities that performed the measurement, at most 100. Declared data: it is not
   * proof that those accounts took part or agree, and nothing is sent to them.
   */
  measurers?: readonly string[] | undefined;
  /** A short comment, suitable for previews. At most 3000 characters and 300 graphemes. */
  comment?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/**
 * The result of {@link createMeasurement}, and what {@link createEvaluation} reports for each of its
 * measurements: the measurement's URI and CID with whether the call created it, and the locations
 * of a new one.
 *
 * @remarks
 * `subjects` and `locations` mirror the input and appear only on a measurement this call created
 * and only when its input had them. Each entry belongs to the input entry at the same index,
 * whether it was created or reused. The measurement {@link createMeasurement} returns is always
 * new (`created: true`).
 */
export interface MeasurementResult extends SupportingRecordRef {
  /** The subjects with the CIDs they were pinned at. `created` is `false` for each. */
  subjects?: readonly SupportingRecordRef[];
  /** The locations, in input order. */
  locations?: readonly SupportingRecordRef[];
}

/**
 * The kind of a measurement. Shared by {@link createMeasurement} and by the `measurements` of
 * {@link createEvaluation}, so a measurement is built the same way in both.
 */
export const measurementKind: RecordKind<MeasurementInput> = recordKind(
  measurement.main,
  {
    metric: l.string(),
    unit: l.string(),
    value: decimalString,
    startDate: optionalText,
    endDate: optionalText,
    methodType: optionalText,
    methodURI: optionalText,
    evidenceURI: l.optional(l.array(l.string())),
    measurers: l.optional(didListInput),
    comment: optionalText,
  },
  { measurers: didListTransform },
  {
    refinements: [dateRange],
    references: {
      subjects: existingRecordsReference,
      locations: locationsReference,
    },
  },
);

/**
 * Creates a measurement (`org.hypercerts.context.measurement`), a measured value that other
 * records can be evidence for, together with the locations it needs, in one atomic write.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 *
 * `value` is a decimal string, stored exactly as written: a JavaScript number throws instead of
 * being converted, so `"0.10"` stays `"0.10"` and a long value loses no digits.
 *
 * Each `locations` entry is either a new location's fields or `{ uri }` of an existing location,
 * which is reused as it is. Each `subjects` entry is `{ uri }` of an existing record of any type;
 * it is pinned by its current CID and never modified, and the subject does not learn about the
 * measurement. Nothing is deduplicated, and order is kept. `measurers` are DIDs stored as given:
 * they are not proof that those accounts took part, and nobody is notified.
 *
 * To measure and evaluate in one call, pass the measurement's fields in `measurements` of
 * {@link createEvaluation}.
 *
 * Everything is created in one write: all the records exist afterwards, or none do. A measurement
 * with no new location is a write of one record. One write holds at most 200 records. The OAuth
 * session needs `create` on the measurement and location collections it writes to.
 *
 * A `{ blob }` in a new location is uploaded. Blobs are uploaded before the write and are not
 * rolled back if it fails; see {@link uploadBlob}.
 *
 * Not supported: the lexicon's `signatures` and `commentFacets`.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The measurement and the locations it needs. See {@link MeasurementInput}.
 * @returns The new Measurement's URI and CID with `created: true`, and the references of its
 * locations in input order. See {@link MeasurementResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `value` that is not a decimal
 * string (a number, `"1,234"`, `"1e3"`), an `endDate` before its `startDate`, a `measurers` entry
 * that is not a DID, a mixed or wrongly typed entry (a `locations` URI that points at another
 * record type, `{ uri }` combined with record fields), more new records than one write holds, or
 * any value the lexicon does not allow. The message names the field. Nothing was written. Blobs
 * may already have been uploaded when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, or
 * an upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling again
 * is not safe: it would create duplicates under new keys if the first attempt had succeeded.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createMeasurement } from "@hypercerts-org/sdk/context";
 *
 * // `context` comes from createSDKContext.
 * const measurement = await createMeasurement(context, {
 *   metric: "Forest area restored",
 *   unit: "hectares",
 *   value: "1234.56", // a string, not a number
 *   subjects: [{ uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" }],
 *   startDate: "2026-01-01T00:00:00.000Z",
 *   endDate: "2026-06-30T00:00:00.000Z",
 *   measurers: ["did:plc:abc123"],
 *   locations: [
 *     {
 *       lpVersion: "1.0",
 *       srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *       locationType: "coordinate-decimal",
 *       location: { string: "90.17,27.47" },
 *     }, // created too
 *   ],
 * });
 * console.log(measurement.uri, measurement.locations?.[0]); // { uri, cid, created: true }
 * ```
 *
 * @example A number is rejected, not converted
 * ```ts
 * import { createMeasurement } from "@hypercerts-org/sdk/context";
 *
 * await createMeasurement(context, {
 *   metric: "Trees planted",
 *   unit: "trees",
 *   value: 5000, // TypeError: must be a decimal number written as a string
 * });
 * ```
 */
export const createMeasurement = creatorOf<MeasurementInput, MeasurementResult>(
  "createMeasurement",
  measurementKind,
);
