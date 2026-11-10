# Profiles and locations

`createProfile` from `@hypercerts-org/sdk/actor` creates an account's profile, and `createLocation` from `@hypercerts-org/sdk/location` creates a location record on its own. Both take the context from `createSDKContext` and return the new record's `{ uri, cid }`. The per-field reference is in the TSDoc of each function, shown in your editor.

## Create a profile

An account has one profile, the `app.certified.actor.profile` record with the key `self`.

```ts
import { createProfile } from "@hypercerts-org/sdk/actor";

// `context` comes from createSDKContext; `avatarFile` is a File.
const { uri, cid } = await createProfile(context, {
  displayName: "Alice",
  description: "Planting trees in the Phobjikha valley.",
  langs: ["en"],
  website: "https://example.org",
  avatar: avatarFile, // uploaded; a URL string would be stored as it is
  banner: "https://example.org/banner.png",
});
```

`avatar` and `banner` take an image `Blob` or `File` (JPEG, PNG or WebP; up to 5 MB for the avatar and 10 MB for the banner) or a URL string. The SDK uploads a `Blob` before it writes the record and stores a URL as it is, without fetching it.

### Browser and Node

In a browser, pass the `File` from an `<input type="file">`. In Node, make a `Blob` that carries its type; the SDK cannot guess it:

```ts
import { openAsBlob } from "node:fs";
import { createProfile } from "@hypercerts-org/sdk/actor";

await createProfile(context, {
  displayName: "Alice",
  avatar: await openAsBlob("./avatar.png", { type: "image/png" }),
});
```

### It only creates

`createProfile` never overwrites a profile, and the SDK has no operation that updates one yet. If the account already has a profile, it throws `ProfileAlreadyExistsError` and the existing profile stays as it is:

```ts
import { createProfile, ProfileAlreadyExistsError } from "@hypercerts-org/sdk/actor";

try {
  await createProfile(context, { displayName: "Alice" });
} catch (error) {
  if (!(error instanceof ProfileAlreadyExistsError)) throw error;
  // The account already has a profile.
}
```

The write is `com.atproto.repo.putRecord` with `swapRecord: null`, which the PDS applies only if no record is at that key. Two simultaneous calls therefore cannot overwrite each other: one creates the profile and the other throws `ProfileAlreadyExistsError`. This was verified against the reference PDS only. Other PDS implementations are not tested.

Because the write is a `putRecord`, an OAuth session needs both the `create` and the `update` permission on `app.certified.actor.profile`, for example the scope `repo:app.certified.actor.profile?action=create&action=update`. The PDS checks both for a `putRecord`, even though `createProfile` never overwrites. With only `create` the PDS answers HTTP 403 and `createProfile` throws `WriteRejectedError`.

If a call ends in `WriteOutcomeUnknownError` (no usable answer from the PDS), you can call `createProfile` again: the profile is only created if absent, so the retry either creates it or throws `ProfileAlreadyExistsError`, which then means the profile exists, most likely from the first attempt. This differs from `createActivity`, where a retry after an unknown outcome could duplicate records.

`ProfileAlreadyExistsError` extends `WriteRejectedError`, so code that handles rejected writes handles it too. A `Blob` image is uploaded before the write and is not rolled back if it fails, including with this error; see [Atomicity and uploads](./creating-activities.md#atomicity-and-uploads).

## Create a location

```ts
import { createLocation } from "@hypercerts-org/sdk/location";

const { uri, cid } = await createLocation(context, {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "90.17,27.47" },
  name: "Phobjikha valley",
});
```

`location` is exactly one of:

| You pass     | Stored as                                                                      |
| ------------ | ------------------------------------------------------------------------------ |
| `{ string }` | The data inside the record, for example coordinates or a small GeoJSON string. |
| `{ uri }`    | A URL to external data such as a GeoJSON file. It is never fetched.            |
| `{ blob }`   | A file (any type, up to 10 MB) that the SDK uploads before writing the record. |

`{ uri }` here is the address of the data. It is not the AT URI of an existing location record; to reuse one of those, pass its URI in `locations` of `createActivity`, see [Creating activities](./creating-activities.md).

Coordinates are longitude first, as in GeoJSON. The SDK does not geocode, and checks `location` against `locationType` for two types only:

- `country-code`: `{ string }` with an uppercase ISO 3166-1 alpha-2 code such as `"BT"`. Only the form is checked.
- `geojson-point` given as `{ string }`: a GeoJSON Point with longitude and latitude in range.

Anything else is stored as given, including values outside the lexicon's known `locationType` list.

Each location gets a new TID as its record key, and `createdAt` is the time of the call. Calling `createLocation` twice creates two records.

## Failures

The write failures are the same as for the other standalone creators: `TypeError` for invalid input (nothing was written), `WriteRejectedError`, `WriteOutcomeUnknownError` and `WriteResultMismatchError`. See [Failures](./creating-activities.md#failures).

## Not covered

Updating or deleting a profile, the organization record, signatures, and reusing an already uploaded blob reference are not part of these functions.
