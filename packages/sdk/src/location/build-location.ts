import { l } from "@atproto/lex";
import * as location from "@hypercerts-org/lexicon/app/certified/location";
import { blob, optionalText } from "../internal/input.js";
import { mediaValue } from "../internal/media.js";
import {
  createStandalone,
  type RecordKind,
  recordKind,
  type StandaloneCreator,
} from "../internal/record-kind.js";

/**
 * Where a location's data is: a URI to external data, the data itself as a string, or a file the
 * SDK uploads.
 *
 * @remarks
 * `{ uri }` here is a URI to external data (for example a GeoJSON file). It is unrelated to the
 * `{ uri }` that refers to an existing record when it stands in the place of a whole location.
 */
export type LocationValue = { uri: string } | { string: string } | { blob: Blob };

/** The data of a new `app.certified.location` record. */
export interface LocationInput {
  /** The version of the Location Protocol, for example `1.0`. At most 10 characters. */
  lpVersion: string;
  /** The spatial reference system URI, for example `http://www.opengis.net/def/crs/OGC/1.3/CRS84`. At most 100 characters. */
  srs: string;
  /**
   * The format of the data, for example `coordinate-decimal`, `geojson-point` or `country-code`.
   * At most 20 characters. Values outside the lexicon's known set are accepted.
   */
  locationType: string;
  /** The location data. See {@link LocationValue}. */
  location: LocationValue;
  /** A human-readable name. At most 100 characters. */
  name?: string | undefined;
  /** Context about the location. At most 500 characters. */
  description?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

const locationValue = l.custom<LocationValue>((value): value is LocationValue => {
  const entries = typeof value === "object" && value !== null ? Object.entries(value) : [];
  const [[key, data] = []] = entries;
  if (entries.length !== 1) return false;
  return key === "blob"
    ? blob.matches(data)
    : (key === "uri" || key === "string") && typeof data === "string";
}, "must be { uri: string } for external data, { string: string } for inline data, or { blob: Blob } to upload a file");

export const locationKind: RecordKind<LocationInput> = recordKind(
  location.main,
  {
    lpVersion: l.string(),
    srs: l.string(),
    locationType: l.string(),
    location: locationValue,
    name: optionalText,
    description: optionalText,
  },
  {
    location: (build, field, value: LocationValue) => {
      if ("string" in value)
        return Promise.resolve(location.string.build({ string: value.string }));
      return mediaValue(build, field, "uri" in value ? value.uri : value.blob, "blob");
    },
  },
);

/**
 * Creates a location record (`app.certified.location`) in the authenticated account's repo.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 * `location` says where the data is: `{ string }` stores it in the record, `{ uri }` points at
 * external data that is stored as a URL and never fetched, and `{ blob }` uploads a file (any type,
 * up to 10 MB) before the record is written. An upload is not part of the write: if the PDS
 * rejects the write, this call leaves the uploaded blob unreferenced. A PDS usually deletes
 * unreferenced blobs after a while, but this is not guaranteed, and a blob with the same content
 * that another record already uses stays.
 *
 * Nothing is geocoded, parsed or checked against `locationType`: the data is stored as you give
 * it, and a `locationType` outside the lexicon's known values is accepted. Nothing is looked up or
 * deduplicated either: calling this twice creates two records. To use a location that already
 * exists, pass its URI in `locations` of {@link createActivity} instead.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The location's data. See {@link LocationInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, a `location` that is not exactly one
 * of `{ uri }`, `{ string }` and `{ blob }`, or a value the lexicon does not allow, for example a
 * `srs` that is not a URI. Nothing was written. Blobs may already have been uploaded when a
 * lexicon rule rejects the record.
 * @throws {@link Error} If the client is not authenticated, or the blob upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS, so the record
 * may or may not exist. It carries the URI to check; the SDK does not retry.
 * @throws {@link WriteResultMismatchError} If the PDS reported a different URI or CID than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createLocation } from "@hypercerts-org/sdk/location";
 *
 * // `context` comes from createSDKContext.
 * const location = await createLocation(context, {
 *   lpVersion: "1.0",
 *   srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *   locationType: "coordinate-decimal",
 *   location: { string: "27.47,90.17" },
 *   name: "Phobjikha valley",
 * });
 * console.log(location.uri, location.cid);
 * ```
 *
 * @example Pointing at external data is not the same as reusing a record
 * ```ts
 * import { createLocation } from "@hypercerts-org/sdk/location";
 *
 * // `{ uri }` here is the address of a GeoJSON file, stored as a URL. It is not the AT URI of an
 * // existing location record, which `createLocation` does not accept.
 * await createLocation(context, {
 *   lpVersion: "1.0",
 *   srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *   locationType: "geojson",
 *   location: { uri: "https://example.org/valley.geojson" },
 * });
 * ```
 */
export const createLocation: StandaloneCreator<LocationInput> = (context, input) =>
  createStandalone(context, "createLocation", locationKind, input);
