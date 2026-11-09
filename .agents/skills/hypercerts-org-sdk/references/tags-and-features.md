# Tags and Features (`@hypercerts-org/sdk/tag`, `@hypercerts-org/sdk/feature`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

| Function              | Import                        | Creates                                                               |
| --------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `createVocabularyTag` | `@hypercerts-org/sdk/tag`     | `org.hypercerts.vocab.tag`, key `<category>.<key>`                    |
| `createWorkScopeTag`  | `@hypercerts-org/sdk/tag`     | `org.hypercerts.workscope.tag`, TID key                               |
| `createFeature`       | `@hypercerts-org/sdk/feature` | `org.hypercerts.entity.feature` (TID key) with its tags and locations |

## Vocabulary tags

```ts
import { createVocabularyTag, RecordAlreadyExistsError } from "@hypercerts-org/sdk/tag";

try {
  const tag = await createVocabularyTag(context, {
    category: "land-cover",
    key: "mangrove",
    name: "Mangrove",
    status: "accepted", // required; the SDK does not pick a governance status
    broader: [{ category: "land-cover", key: "forest", name: "Forest", status: "accepted" }], // created too
  });
  tag.uri; // at://<did>/org.hypercerts.vocab.tag/land-cover.mangrove
} catch (error) {
  if (!(error instanceof RecordAlreadyExistsError)) throw error;
  error.uri; // the tag already there; use it as { uri } instead
}
```

- The record key is `<category>.<key>` exactly as given. No lowercasing or trimming. Both parts must be record keys **without dots** (a dot is a `TypeError`).
- It only creates. A taken key throws `RecordAlreadyExistsError` and changes nothing; there is no update.
- Only this tag (no new nested tags): `putRecord` with `swapRecord: null`, race-safe, checked against the reference PDS only. An OAuth session needs **both** `create` and `update` on `org.hypercerts.vocab.tag` (for example `repo:org.hypercerts.vocab.tag?action=create&action=update`); with only `create` the PDS answers 403 and you get `WriteRejectedError`.
- With new nested tags: one `applyWrites`, after the SDK has read each new key and found none taken. Only `create` is needed.
- After `WriteOutcomeUnknownError` it is safe to call again (it creates the tags or throws `RecordAlreadyExistsError`).
- Fields: `description`, `aliases` (≤ 50), `sameAs` (URIs, ≤ 20), `referenceDocument` (`Blob` up to 10 MB, uploaded, or a URL), `broader[]` (≤ 20), `supersededBy`, `createdAt`.

## Work-scope tags

```ts
import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";

const tag = await createWorkScopeTag(context, {
  key: "mangrove_restoration", // lowercase, underscore-separated; CEL names the tag by it
  name: "Mangrove restoration",
  category: "topic",
  parent: { uri: "at://did:plc:abc123/org.hypercerts.workscope.tag/3k2a4b5c6d7e8" }, // or new fields
});
```

TID key, so two calls create two tags, also with the same `key`. `status`, `supersededBy` and the same optional fields as above.

## Features

```ts
import { createFeature } from "@hypercerts-org/sdk/feature";

const feature = await createFeature(context, {
  type: "zone",
  title: "Phobjikha restoration zone",
  description: "The valley floor.", // string | Leaflet document | { uri } of any record
  tags: [
    { category: "zone-role", key: "site", name: "Site", status: "accepted" }, // new
    { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/land-cover.wetland" }, // existing
  ],
  locations: [
    { lpVersion: "1.0", srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84", locationType: "coordinate-decimal", location: { string: "27.47,90.17" } },
  ],
});
feature.tags[0]; // { uri, cid, created: true }
feature.locations[0]; // { uri, cid, created: true }
```

- `description`: a string is stored as `descriptionString`; a Leaflet document (it needs `$type: "pub.leaflet.pages.linearDocument"`) as it is, validated by the lexicon; `{ uri }` becomes a strong reference to that record (any type, CID read first). The SDK never creates a document record.
- `locations` are alternative representations of one subject, **most preferred first**; order is kept, empty is allowed.
- Before uploading or writing, the SDK reads each new vocabulary tag's key. A taken key throws `RecordAlreadyExistsError` naming the URI and nothing is written. Two new tags with the same key in one call are a `TypeError`; create the shared tag first and pass its `uri`.
- One `applyWrites` creates everything. The session needs `create` on the Feature, vocabulary tag and location collections.
- `createFeature` is not safe to repeat after `WriteOutcomeUnknownError`: check the attempted URIs first.

## Relationships

Every field that points at a record takes either the fields of a new record or `{ uri }` of an existing one, never a mix:

| Record               | Field                       | Accepts                              |
| -------------------- | --------------------------- | ------------------------------------ |
| Vocabulary tag       | `broader[]`, `supersededBy` | vocabulary tags                      |
| Work-scope tag       | `parent`, `supersededBy`    | work-scope tags                      |
| Feature              | `tags[]`                    | vocabulary tags                      |
| Feature              | `locations[]`               | locations (`app.certified.location`) |
| Activity `workScope` | `usedTags[]`                | work-scope tags                      |

New records nest to any depth, and the result mirrors the input (`result.broader[0].broader[0]`). An existing `{ uri }` must be of the right collection (a work-scope tag is not a vocabulary tag) and use a DID, or the call throws a `TypeError` naming the field. Order is kept and nothing is deduplicated. More than 200 new records in one call is a `TypeError` (the reference PDS's `applyWrites` limit); the SDK does not split it.

## CEL work scope in `createActivity`

`workScope` takes a string, or a CEL scope:

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";

const result = await createActivity(context, {
  title: "Mangrove restoration in Kenya",
  shortDescription: "Replanting 20 hectares.",
  workScope: {
    expression: "scope.hasAll(['mangrove_restoration', 'environmental_education'])",
    usedTags: [
      { key: "mangrove_restoration", name: "Mangrove restoration" }, // created in the same write
      { uri: "at://did:plc:abc123/org.hypercerts.workscope.tag/3k2a4b5c6d7e8" }, // existing
    ],
    // version defaults to "v1", createdAt to the time of the call
  },
});
result.workScope?.usedTags[0]; // { uri, cid, created: true }
```

The expression is stored exactly as written; the SDK does not parse or evaluate it and does not check that `usedTags` matches the tags it names.

## Pitfalls

- A dot in a vocabulary tag's `category` or `key` throws; the key is `<category>.<key>`.
- Passing a work-scope tag URI to `tags`/`broader` (or a vocabulary tag URI to `parent`/`usedTags`) throws.
- A Leaflet document passed as `description` must carry its `$type`.
- Do not expect an update: `createVocabularyTag` on an existing key is `RecordAlreadyExistsError`.
