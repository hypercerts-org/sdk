# Activity domain (`@hypercerts-org/sdk/activity`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

## createActivity

`createActivity(context, input)` writes the Activity and every **new** supporting record in one `applyWrites` request. Either all of them are created or none are.

Each supporting field takes one of three shapes. The shape decides what happens, so the SDK never has to guess:

| Shape                                         | Meaning                                                      | Allowed in                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| record fields `{ ... }`                       | create a new record                                          | `rights`, `locations[]`, `contributors[].identity`, `contributors[].details`, `workScope.usedTags[]` |
| `{ uri: "at://did:.../<collection>/<rkey>" }` | reuse an existing record (read for its CID, never rewritten) | the same fields                                                                                      |
| `{ inline: "..." }`                           | store only the string in the Activity, no record             | `contributors[].identity` (DID or name), `contributors[].details` (role)                             |

### Minimal

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";
import { context } from "./sdk";

const { uri, cid } = await createActivity(context, {
  title: "Community garden 2024",
  shortDescription: "Built and ran a 40-bed community garden in Thimphu.",
});
```

### Everything new in one call

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";

// `cover` is a File from <input type="file">, or a Blob in Node.
const result = await createActivity(context, {
  title: "Reforestation in the Phobjikha valley",
  shortDescription: "Planting 5,000 native trees.",
  description: "## Goals\nRestore crane habitat along the valley floor.",
  langs: ["en"],
  image: cover, // uploaded by the SDK; a URL string is stored as-is instead
  workScope: "reforestation, native species", // or a CEL scope, see the tags reference
  startDate: "2024-03-01T00:00:00Z",
  endDate: "2024-11-30T00:00:00Z",
  rights: {
    rightsName: "CC BY 4.0",
    rightsType: "CC-BY",
    rightsDescription: "Free to share and adapt with attribution.",
  },
  locations: [
    {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "coordinate-decimal",
      location: { string: "90.17,27.47" },
      name: "Phobjikha valley",
    },
  ],
  contributors: [
    {
      identity: { identifier: "did:plc:alice123", displayName: "Alice" },
      details: { role: "Field lead", contributionDescription: "Ran the planting days." },
      weight: "2",
    },
    { identity: { displayName: "Village volunteers" }, weight: "1" },
  ],
});

result.uri; // the Activity
result.rights; // { uri, cid, created: true }
result.locations[0]; // { uri, cid, created: true }
result.contributors[0].identity; // { uri, cid, created: true }
```

### Reuse records across Activities

Nothing is looked up or deduplicated. Calling `createActivity` twice with the same rights _data_ creates two rights records. To share one record, create it once and pass its URI:

```ts
import {
  createActivity,
  createContributorInformation,
  createRights,
} from "@hypercerts-org/sdk/activity";

const license = await createRights(context, {
  rightsName: "CC BY 4.0",
  rightsType: "CC-BY",
  rightsDescription: "Free to share and adapt with attribution.",
  attachment: "https://creativecommons.org/licenses/by/4.0/legalcode",
});
const alice = await createContributorInformation(context, {
  identifier: "did:plc:alice123",
  displayName: "Alice",
});

for (const season of ["Spring", "Autumn"]) {
  await createActivity(context, {
    title: `Planting season: ${season}`,
    shortDescription: `Tree planting, ${season.toLowerCase()} 2024.`,
    rights: { uri: license.uri },
    contributors: [{ identity: { uri: alice.uri }, details: { inline: "Field lead" } }],
  });
}
```

Store those URIs (in your DB, for example) so later calls can reuse them.

### Inline contributors (no extra records)

```ts
await createActivity(context, {
  title: "Beach clean-up",
  shortDescription: "Removed 300 kg of plastic.",
  contributors: [
    { identity: { inline: "did:plc:bob456" }, details: { inline: "Organiser" }, weight: "1" },
    { identity: { inline: "Jane Doe" } },
  ],
});
```

### Reading the result

`locations[i]` and `contributors[i]` match the input entry at the same index, whatever its shape. Inline entries come back as `{ inline }`. To get only the records this call created:

```ts
const createdLocations = result.locations.filter((ref) => ref.created);
```

## Supporting records on their own

`createRights`, `createContribution` and `createContributorInformation` take `(context, input)` and return `{ uri, cid }`. A location is created on its own with `createLocation`; see [location.md](location.md).

```ts
import { createContribution } from "@hypercerts-org/sdk/activity";

const details = await createContribution(context, {
  role: "Field coordinator",
  contributionDescription: "Organised the planting days.",
  startDate: "2024-03-01T00:00:00Z",
  endDate: "2024-06-30T00:00:00Z",
});
```

## Activity pitfalls

- A `{ uri }` must use a DID authority, not a handle, and point at the right collection (`org.hypercerts.claim.rights` for `rights`, `app.certified.location` for locations, `org.hypercerts.claim.contributorInformation` for `identity`, `org.hypercerts.claim.contribution` for `details`). Do not mix `uri` with other fields.
- `weight` is a positive decimal **string** (`"0.5"`), not a number. Weights don't have to add up to anything.
- A location's `location: { uri }` is a link to external data (e.g. a GeoJSON file). That is different from a whole location given as `{ uri }`, which reuses an existing location record.
- Dates are ISO 8601 date-times (`"2024-03-01T00:00:00Z"`), not bare dates. `endDate` must not be before `startDate`.
- Not supported yet: `signatures`, `shortDescriptionFacets`, non-string `description`, updates and deletes.

## Field reference

Dates are ISO 8601 date-times. `createdAt` is optional on every record and defaults to the time of the call. If the installed `.d.ts` disagrees, trust the `.d.ts`.

### `ActivityInput` (`org.hypercerts.claim.activity`)

| Field                  | Type                           | Notes                                          |
| ---------------------- | ------------------------------ | ---------------------------------------------- |
| `title`                | `string`                       | Required. Max 256 chars.                       |
| `shortDescription`     | `string`                       | Required. Max 300 chars.                       |
| `description`          | `string`                       | Plain text or Markdown.                        |
| `langs`                | `string[]`                     | BCP-47 tags of the text's languages, up to 3. Usually one; more only for mixed-language text. |
| `image`                | `Blob \| string`               | JPEG/PNG/WebP up to 5 MB (uploaded), or a URL. |
| `workScope`            | `string \| CelWorkScopeInput`  | Free-form, or a CEL scope (tags reference).    |
| `startDate`, `endDate` | `string`                       | `endDate` ≥ `startDate`.                       |
| `rights`               | `RightsInput \| { uri }`       |                                                |
| `locations`            | `(LocationInput \| { uri })[]` |                                                |
| `contributors`         | `ContributorInput[]`           | See below.                                     |

### `ContributorInput`

| Field      | Type                                                           | Notes                                   |
| ---------- | -------------------------------------------------------------- | --------------------------------------- |
| `identity` | `ContributorInformationInput \| { uri } \| { inline: string }` | Required. Inline is a DID or a name.    |
| `details`  | `ContributionInput \| { uri } \| { inline: string }`           | Inline is a role.                       |
| `weight`   | `string`                                                       | Positive decimal, e.g. `"1"`, `"0.25"`. |

### `RightsInput` (`org.hypercerts.claim.rights`)

| Field               | Type             | Notes                                         |
| ------------------- | ---------------- | --------------------------------------------- |
| `rightsName`        | `string`         | Required. Max 100 chars, e.g. `CC BY-SA 4.0`. |
| `rightsType`        | `string`         | Required. Max 10 chars, e.g. `CC-BY-SA`.      |
| `rightsDescription` | `string`         | Required. Max 1000 chars.                     |
| `attachment`        | `Blob \| string` | Up to 10 MB (uploaded), or a URL.             |

### `ContributorInformationInput` (`org.hypercerts.claim.contributorInformation`)

| Field         | Type             | Notes                               |
| ------------- | ---------------- | ----------------------------------- |
| `identifier`  | `string`         | DID or profile URI, max 2048 chars. |
| `displayName` | `string`         | Max 100 chars.                      |
| `image`       | `Blob \| string` | JPEG/PNG/WebP up to 5 MB, or a URL. |

### `ContributionInput` (`org.hypercerts.claim.contribution`)

| Field                     | Type     | Notes                                                              |
| ------------------------- | -------- | ------------------------------------------------------------------ |
| `role`                    | `string` | Max 100 chars.                                                     |
| `contributionDescription` | `string` | Max 1000 chars.                                                    |
| `startDate`, `endDate`    | `string` | `endDate` ≥ `startDate`. Not checked against the Activity's dates. |

### `LocationInput` (`app.certified.location`)

See [location.md](location.md#locationinput-appcertifiedlocation) for the fields and the three `location` shapes.
