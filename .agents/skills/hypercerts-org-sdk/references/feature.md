# Feature domain (`@hypercerts-org/sdk/feature`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

`createFeature` creates an `org.hypercerts.entity.feature` (TID key) together with its new vocabulary tags and locations. For the tag fields see [tag.md](tag.md); for location fields see [location.md](location.md).

## createFeature

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
    { lpVersion: "1.0", srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84", locationType: "coordinate-decimal", location: { string: "90.17,27.47" } },
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

| Field         | Accepts                                                  |
| ------------- | -------------------------------------------------------- |
| `tags[]`      | vocabulary tags (`org.hypercerts.vocab.tag`)             |
| `locations[]` | locations (`app.certified.location`)                     |
| `description` | `{ uri }` of any record (never created by the SDK)      |

New records nest to any depth, and the result mirrors the input (`feature.tags[0].broader[0]`). An existing `{ uri }` must be of the right collection (a work-scope tag is not a vocabulary tag) and use a DID, or the call throws a `TypeError` naming the field. Order is kept and nothing is deduplicated. More than 200 new records in one call is a `TypeError` (the reference PDS's `applyWrites` limit); the SDK does not split it.

## Pitfalls

- Passing a work-scope tag URI to `tags` throws; it holds vocabulary tags.
- A Leaflet document passed as `description` must carry its `$type`.
- `createFeature` is not safe to repeat after `WriteOutcomeUnknownError`: check the attempted URIs first.
