import { l } from "@atproto/lex";
import * as location from "@hypercerts-org/lexicon/app/certified/location";
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
  /** The spatial reference system URI, for example `http://www.opengis.net/def/crs/OGC/1.3/CRS84`. */
  srs: string;
  /** The format of the data, for example `coordinate-decimal` or `geojson-point`. At most 20 characters. */
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
