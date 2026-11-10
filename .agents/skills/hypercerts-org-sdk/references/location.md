# Location domain (`@hypercerts-org/sdk/location`)

`createLocation(context, input)` creates one `app.certified.location` record in the signed-in account's repo and returns `{ uri, cid }`. The record key is a new TID.

Create a location on its own when several activities share it. For a location used by one activity, pass it inline in `createActivity`'s `locations` instead (see [activity.md](activity.md)).

## Examples

### A country

```ts
import { createLocation } from "@hypercerts-org/sdk/location";

// `context` comes from createSDKContext.
await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84", // required, but ignored for country-code
  locationType: "country-code",
  location: { string: "BT" }, // uppercase ISO 3166-1 alpha-2
  name: "Bhutan",
});
```

### Coordinates stored in the record

```ts
import { createLocation } from "@hypercerts-org/sdk/location";

// `context` comes from createSDKContext.
const valley = await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "geojson-point",
  location: { string: JSON.stringify({ type: "Point", coordinates: [90.17, 27.47] }) }, // [lon, lat]
  name: "Phobjikha valley",
  description: "Wetland restoration site.",
});
console.log(valley.uri); // at://<did>/app.certified.location/<tid>
```

### Link to external data

```ts
await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "geojson",
  // Stored as a URL and never fetched. Not an AT URI of a location record.
  location: { uri: "https://example.org/valley.geojson" },
});
```

### Upload a file

```ts
// `file` comes from an <input type="file">. Browsers often give .geojson files no type, and a
// Blob without a type cannot be uploaded (createLocation has no `mimeType` option), so set one.
const geojsonFile = file.type ? file : new Blob([file], { type: "application/geo+json" });
await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "geojson",
  location: { blob: geojsonFile }, // uploaded before the write
});
```

### Create once, reuse in several activities

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";
import { createLocation } from "@hypercerts-org/sdk/location";

const valley = await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "90.17,27.47" },
});

// A whole location given as { uri } refers to the existing record; nothing new is created.
for (const title of ["Crane habitat restoration", "Wetland monitoring"]) {
  await createActivity(context, {
    title,
    shortDescription: "Work in the Phobjikha valley.",
    locations: [{ uri: valley.uri }],
  });
}
```

## Choosing `locationType`

Follow these conventions so indexers and other apps can read the record. The SDK enforces the first two rows and throws `TypeError` otherwise; the rest are not checked. They come from the lexicon's description and the [Location Protocol location types](https://spec.decentralizedgeo.org/specification/location-types/).

| `locationType`       | Put in `location`                                                                                   | Example                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `country-code`       | `{ string }` with an uppercase ISO 3166-1 alpha-2 code. `srs` is still required but has no meaning. | `{ string: "BT" }`, not `"bt"`, `"BTN"` or `"Bhutan"`                        |
| `geojson-point`      | A single GeoJSON Point (RFC 7946), inline, linked or uploaded                                       | `{ string: '{"type":"Point","coordinates":[90.17,27.47]}' }`                 |
| `geojson`            | Any other GeoJSON: Polygon, MultiPolygon, FeatureCollection, ... Its own `type` says which.        | `{ blob: polygonFile }` or `{ uri: "https://example.org/valley.geojson" }` |
| `coordinate-decimal` | A decimal-degree pair, **longitude first**                                                          | `{ string: "90.17,27.47" }`                                                  |
| `h3`, `geohash`, `wkt`, `address`, `scaledCoordinates` | The value in that format | `{ string: "POINT (90.17 27.47)" }` for `wkt` |

- Coordinates are **longitude, latitude** with the CRS84 `srs`, in both GeoJSON and `coordinate-decimal`. For an inline `geojson-point` the SDK rejects a latitude outside ±90, but most swapped pairs are still in range and go through.
- A `geojson-point` given as `{ uri }` or `{ blob }` is not read, so it is not checked.
- `country-code` checks only the form: `"XX"` passes.
- Prefer `geojson-point` over `coordinate-decimal` for a point: GeoJSON fixes the order and the separator, while the spec does not say how a `coordinate-decimal` pair is written as a string.
- Use the most specific type: `geojson-point` for one point, `geojson` for everything else in GeoJSON.
- Other values are allowed by the lexicon, but other apps may not understand them. Use one from the spec's registry when you can.

## The `location` value

Exactly one key:

| Shape        | Stored as                                                | Example                                         |
| ------------ | -------------------------------------------------------- | ----------------------------------------------- |
| `{ string }` | Inline in the record                                     | `{ string: "90.17,27.47" }`                     |
| `{ uri }`    | A URL to external data, never fetched                    | `{ uri: "https://example.org/valley.geojson" }` |
| `{ blob }`   | A file uploaded before the write (any type, up to 10 MB) | `{ blob: geojsonFile }`                         |

## Imports

`LocationInput` and `LocationValue` are exported from both `/location` and `/activity`. They are the same types. Import from the subpath you already use: `/location` for `createLocation`, `/activity` for `createActivity`.

## Pitfalls

- `location: { uri }` (external data) is not the same as a whole location `{ uri }` in `createActivity` (an existing record). `createLocation` never accepts an AT URI of a location record.
- Passing a bare string or a GeoJSON object as `location` throws `TypeError`. Wrap it: `{ string: "..." }`, or `{ string: JSON.stringify(geojson) }`.
- Nothing is geocoded. Apart from `country-code` and inline `geojson-point`, `location` is not checked against `locationType`. Values outside the lexicon's known list are accepted.
- Nothing is deduplicated: calling `createLocation` twice creates two records. Keep the returned `uri` and reuse it.
- A `{ blob }` needs a MIME type. A `File` the browser could not type (common for `.geojson`) fails with "could not upload location"; wrap it as shown in [Upload a file](#upload-a-file).
- A `{ blob }` is uploaded before the write and is not rolled back if it fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write).

## `LocationInput` (`app.certified.location`)

Also accepted inline in `createActivity`'s `locations`.

| Field          | Type                                | Notes                                                                               |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `lpVersion`    | `string`                            | Required. Location Protocol version, e.g. `"1.0"`. Max 10 chars.                    |
| `srs`          | `string`                            | Required. Spatial reference system URI, e.g. `http://www.opengis.net/def/crs/OGC/1.3/CRS84`. Max 100 chars. |
| `locationType` | `string`                            | Required. See [Choosing `locationType`](#choosing-locationtype). Max 20 chars. |
| `location`     | `{ uri } \| { string } \| { blob }` | Required. See [the `location` value](#the-location-value).                          |
| `name`         | `string`                            | Max 100 chars.                                                                      |
| `description`  | `string`                            | Max 500 chars.                                                                      |
| `createdAt`    | `string`                            | ISO 8601 date-time. Defaults to the time of the call.                               |
