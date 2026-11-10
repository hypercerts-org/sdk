import { l } from "@atproto/lex";
import * as location from "@hypercerts-org/lexicon/app/certified/location";
import { createStandalone, type StandaloneCreator } from "../internal/create-record.js";
import { blob, optionalText } from "../internal/input.js";
import { mediaValue } from "../internal/media.js";
import { type RecordKind, recordKind } from "../internal/record-kind.js";

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
   *
   * Two types have their `location` checked: `country-code` needs `{ string }` with an uppercase
   * ISO 3166-1 alpha-2 code (`"BT"`), and `geojson-point` given as `{ string }` needs a GeoJSON
   * Point with `[longitude, latitude]` coordinates.
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
  {
    refinements: [
      {
        check: (input: LocationInput) =>
          input.locationType !== "country-code" ||
          ("string" in input.location && isCountryCode(input.location.string)),
        message:
          'must be { string } with an uppercase ISO 3166-1 alpha-2 code, such as { string: "BT" }, when locationType is "country-code"',
        path: "location",
      },
      {
        check: (input: LocationInput) =>
          input.locationType !== "geojson-point" ||
          !("string" in input.location) ||
          isGeoJsonPoint(input.location.string),
        message:
          'must be a GeoJSON Point with [longitude, latitude] coordinates, such as { string: \'{"type":"Point","coordinates":[90.17,27.47]}\' }, when locationType is "geojson-point"',
        path: "location",
      },
    ],
  },
);

// The lexicon asks for uppercase ISO 3166-1 alpha-2. Only the form is checked, not that the code is
// assigned, so the SDK needs no country list.
function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

// RFC 7946 Point: a position of longitude, latitude and an optional altitude. Range checks catch
// swapped coordinates only when the latitude ends up outside ±90.
function isGeoJsonPoint(value: string): boolean {
  let point: unknown;
  try {
    point = JSON.parse(value);
  } catch {
    return false;
  }
  if (typeof point !== "object" || point === null) return false;
  const { type, coordinates } = point as { type?: unknown; coordinates?: unknown };
  if (type !== "Point" || !Array.isArray(coordinates)) return false;
  const [longitude, latitude, ...rest] = coordinates as unknown[];
  return (
    rest.length <= 1 &&
    rest.every(Number.isFinite) &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude as number) <= 180 &&
    Math.abs(latitude as number) <= 90
  );
}

/**
 * Creates a location record (`app.certified.location`) in the authenticated account's repo.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 * `location` says where the data is: `{ string }` stores it in the record, `{ uri }` points at
 * external data that is stored as a URL and never fetched, and `{ blob }` uploads a file (any type,
 * up to 10 MB) before the record is written. Blobs are uploaded before the write and are not
 * rolled back if it fails; see {@link uploadBlob}.
 *
 * The data is stored as you give it and nothing is geocoded. Only two types are checked:
 * `country-code` must be `{ string }` with an uppercase ISO 3166-1 alpha-2 code, as the lexicon
 * asks (only the form is checked, not that the code is assigned), and an inline `geojson-point`
 * must be a GeoJSON Point whose longitude and latitude are in range. Coordinates are longitude
 * first; swapped ones are caught only when the latitude falls outside ±90. A `{ uri }` or
 * `{ blob }` geojson-point is not read. A `locationType` outside the lexicon's known values is
 * accepted. Nothing is looked up or
 * deduplicated either: calling this twice creates two records. To use a location that already
 * exists, pass its URI in `locations` of {@link createActivity} instead.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The location's data. See {@link LocationInput}.
 * @returns The new record's URI and CID.
 * @throws {@link TypeError} If `input` has an unknown field, a `location` that is not exactly one
 * of `{ uri }`, `{ string }` and `{ blob }`, a `location` that does not match a `country-code` or
 * `geojson-point` `locationType` (see remarks), or a value the lexicon does not allow, for example a
 * `srs` that is not a URI. Nothing was written. Blobs may already have been uploaded when a
 * lexicon rule rejects the record.
 * @throws {@link Error} If the client is not authenticated, or the blob upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS.
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
 *   locationType: "geojson-point",
 *   location: { string: '{"type":"Point","coordinates":[90.17,27.47]}' }, // [longitude, latitude]
 *   name: "Phobjikha valley",
 * });
 * console.log(location.uri, location.cid);
 * ```
 *
 * @example A country
 * ```ts
 * import { createLocation } from "@hypercerts-org/sdk/location";
 *
 * await createLocation(context, {
 *   lpVersion: "1.0",
 *   srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84", // required, but means nothing here
 *   locationType: "country-code",
 *   location: { string: "BT" }, // not "bt", "BTN" or "Bhutan", which throw
 * });
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
