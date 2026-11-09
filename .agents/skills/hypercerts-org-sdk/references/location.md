# Location domain (`@hypercerts-org/sdk/location`)

`createLocation(context, input)` creates one `app.certified.location` record in the signed-in account's repo and returns `{ uri, cid }`. The record key is a new TID.

Create a location on its own when several activities share it. For a location used by one activity, pass it inline in `createActivity`'s `locations` instead (see [activity.md](activity.md)).

## Examples

### Coordinates stored in the record

```ts
import { createLocation } from "@hypercerts-org/sdk/location";

// `context` comes from createSDKContext.
const valley = await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
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
// `geojsonFile` is a File or Blob, for example from an <input type="file">.
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
  location: { string: "27.47,90.17" },
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

## The `location` value

Exactly one key:

| Shape        | Stored as                                                | Example                                         |
| ------------ | -------------------------------------------------------- | ----------------------------------------------- |
| `{ string }` | Inline in the record                                     | `{ string: "27.47,90.17" }`                     |
| `{ uri }`    | A URL to external data, never fetched                    | `{ uri: "https://example.org/valley.geojson" }` |
| `{ blob }`   | A file uploaded before the write (any type, up to 10 MB) | `{ blob: geojsonFile }`                         |

## Imports

`LocationInput` and `LocationValue` are exported from both `/location` and `/activity`. They are the same types. Import from the subpath you already use: `/location` for `createLocation`, `/activity` for `createActivity`.

## Pitfalls

- `location: { uri }` (external data) is not the same as a whole location `{ uri }` in `createActivity` (an existing record). `createLocation` never accepts an AT URI of a location record.
- Passing a bare string or a GeoJSON object as `location` throws `TypeError`. Wrap it: `{ string: "..." }`, or `{ string: JSON.stringify(geojson) }`.
- Nothing is geocoded, parsed or checked against `locationType`. Values outside the lexicon's known list are accepted.
- Nothing is deduplicated: calling `createLocation` twice creates two records. Keep the returned `uri` and reuse it.
- A `{ blob }` upload is not rolled back if the write fails. See "Images and files" in [SKILL.md](../SKILL.md).

## `LocationInput` (`app.certified.location`)

Also accepted inline in `createActivity`'s `locations`.

| Field          | Type                                | Notes                                                                               |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `lpVersion`    | `string`                            | Required. Location Protocol version, e.g. `"1.0"`. Max 10 chars.                    |
| `srs`          | `string`                            | Required. Spatial reference system URI, e.g. `http://www.opengis.net/def/crs/OGC/1.3/CRS84`. Max 100 chars. |
| `locationType` | `string`                            | Required. e.g. `coordinate-decimal`, `geojson-point`, `country-code`. Max 20 chars. |
| `location`     | `{ uri } \| { string } \| { blob }` | Required. See [the `location` value](#the-location-value).                          |
| `name`         | `string`                            | Max 100 chars.                                                                      |
| `description`  | `string`                            | Max 500 chars.                                                                      |
| `createdAt`    | `string`                            | ISO 8601 date-time. Defaults to the time of the call.                               |
