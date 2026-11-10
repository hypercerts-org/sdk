# Tags and Features

`createVocabularyTag` and `createWorkScopeTag` from `@hypercerts-org/sdk/tag` create tags, and `createFeature` from `@hypercerts-org/sdk/feature` creates a Feature (a subject such as a land zone) together with the tags and locations it needs. They take the context from `createSDKContext`. The per-field reference is in the TSDoc of each function, shown in your editor. A structured work scope for an Activity uses work-scope tags; see [Creating activities](./creating-activities.md#work-scope).

## Vocabulary tags

A vocabulary tag (`org.hypercerts.vocab.tag`) is a reusable term for classifying records, for example a land-cover class or a zone role.

```ts
import { createVocabularyTag } from "@hypercerts-org/sdk/tag";

// `context` comes from createSDKContext.
const tag = await createVocabularyTag(context, {
  category: "land-cover",
  key: "mangrove",
  name: "Mangrove",
  status: "accepted",
  broader: [{ category: "land-cover", key: "forest", name: "Forest", status: "accepted" }], // created too
});
// tag.uri is at://<did>/org.hypercerts.vocab.tag/land-cover.mangrove
```

- **The record key is `<category>.<key>`, exactly as you give them.** The SDK does not lowercase or trim either part. Both must be valid record keys and must not contain dots, because a dot would make the key ambiguous; a dot throws a `TypeError` before anything is sent.
- **`status` is required** (`proposed`, `accepted` or `deprecated`; other values are accepted). The SDK does not decide a term's governance status for you.
- Nothing is searched for or deduplicated, and the SDK has no operation that updates a tag. `aliases`, `sameAs`, `description` and `referenceDocument` (a URL, or a `Blob` the SDK uploads) are stored as given.

### It only creates

One account has at most one tag per category and key. If the key is taken, `createVocabularyTag` throws `RecordAlreadyExistsError` and the existing tag stays as it is. Its `uri` property names the tag in the way, so you can use that tag instead:

```ts
import { createVocabularyTag, RecordAlreadyExistsError } from "@hypercerts-org/sdk/tag";

try {
  await createVocabularyTag(context, {
    category: "land-cover",
    key: "mangrove",
    name: "Mangrove",
    status: "accepted",
  });
} catch (error) {
  if (!(error instanceof RecordAlreadyExistsError)) throw error;
  console.log(error.uri); // pass this as { uri } where a tag is accepted
}
```

`RecordAlreadyExistsError` extends `WriteRejectedError`, so code that handles rejected writes handles it too; `status` is `400` and `code` is `InvalidSwap`, as the PDS reports a taken key. `ProfileAlreadyExistsError` extends it as well.

How the write is made depends on what the call creates:

- **Only this tag** (no new nested tags): `com.atproto.repo.putRecord` with `swapRecord: null`, which the PDS applies only if no record is at that key. Two simultaneous calls therefore cannot overwrite each other: one creates the tag and the other throws `RecordAlreadyExistsError`. This was verified against the reference PDS only. Because the write is a `putRecord`, an OAuth session needs both the `create` and the `update` permission on `org.hypercerts.vocab.tag`, for example the scope `repo:org.hypercerts.vocab.tag?action=create&action=update`. With only `create` the PDS answers HTTP 403 and the call throws `WriteRejectedError`.
- **This tag and new nested tags**: one `applyWrites` request creates all of them. A batch has no "only if absent" option, so the SDK first reads each new tag's key with `com.atproto.repo.getRecord` and throws `RecordAlreadyExistsError` before uploading or writing anything if one exists. This needs only the `create` permission.

After a `WriteOutcomeUnknownError` you can call `createVocabularyTag` again: every tag it creates has a fixed key, so a retry never creates duplicates. It does not prove the first attempt succeeded, though:

- `RecordAlreadyExistsError` means one of the keys is taken, not that every tag exists. A nested tag may have been created by someone else in the meantime. Check each URI listed in the error from the first attempt before treating the batch as complete.
- If the first write is still in flight, the retry can pass its key checks and then conflict with it. The reference PDS answers that with HTTP 500, so the retry throws `WriteOutcomeUnknownError` again. Wait, then check the URIs.

## Work-scope tags

A work-scope tag (`org.hypercerts.workscope.tag`) is a scope atom that CEL work scope expressions are built from.

```ts
import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";

const tag = await createWorkScopeTag(context, {
  key: "mangrove_restoration",
  name: "Mangrove restoration",
  category: "topic",
  parent: { key: "ecosystem_restoration", name: "Ecosystem restoration" }, // created too
});
```

Its record key is a new TID chosen by the SDK, so calling it twice creates two tags, also with the same `key`. It always uses `applyWrites`, so only the `create` permission is needed.

## Relationships

Every field that points at another record takes the same two choices, and the SDK never guesses which you mean:

| You pass               | Meaning                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| The fields of a record | Create a new record in the same write. It can have relationships of its own.      |
| `{ uri }`              | Reuse an existing record. Its current CID is read; the record is never rewritten. |

| Record               | Field                       | Accepts                              |
| -------------------- | --------------------------- | ------------------------------------ |
| Vocabulary tag       | `broader[]`, `supersededBy` | vocabulary tags                      |
| Work-scope tag       | `parent`, `supersededBy`    | work-scope tags                      |
| Feature              | `tags[]`                    | vocabulary tags                      |
| Feature              | `locations[]`               | locations (`app.certified.location`) |
| Activity `workScope` | `usedTags[]`                | work-scope tags                      |

- New records can be nested to any depth.
- An existing record must be of the type the field holds. A work-scope tag is not a vocabulary tag, and passing one where the other is expected is a `TypeError` that names the field and both types, before anything is sent. `{ uri }` must use a DID, not a handle.
- Array order is kept, nothing is deduplicated, and an empty array is allowed.
- Two **new** vocabulary tags in one call cannot have the same key, because they would be the same record. To use one tag in several places, create it first and pass its `uri`.
- Everything is created in one write: all of it exists afterwards, or none does.
- One write holds at most 200 records. A larger call throws a `TypeError` before anything is uploaded. Create some records first and pass their URIs.

## Features

A Feature (`org.hypercerts.entity.feature`) is a subject that other records can be about. It has a TID record key, chosen by the SDK.

```ts
import { createFeature } from "@hypercerts-org/sdk/feature";

const feature = await createFeature(context, {
  type: "zone",
  title: "Phobjikha restoration zone",
  description: "The valley floor north of the crane centre.",
  langs: ["en"],
  tags: [
    { category: "zone-role", key: "site", name: "Site", status: "accepted" }, // created
    { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/land-cover.wetland" }, // reused; placeholder, use an existing tag's URI
  ],
  locations: [
    {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "coordinate-decimal",
      location: { string: "90.17,27.47" },
    }, // created
  ],
});
// feature.uri and feature.cid identify the Feature. feature.tags[i] and feature.locations[i] mirror
// the input; each has `created: true` if this call wrote it. A new tag's own broader tags are
// reported under it.
```

`locations` are alternative representations of the same subject (different precision or encoding), never different places, and writers list the preferred one first; the SDK keeps your order. A new location can hold a file (`location: { blob }`, uploaded before the write), see [Profiles and locations](./profiles-and-locations.md#create-a-location).

### Descriptions

`description` takes one of three forms:

| You pass                                                         | Stored as                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A string                                                         | The lexicon's `descriptionString`.                                                      |
| A Leaflet document (`$type: "pub.leaflet.pages.linearDocument"`) | The document as it is. The lexicon validates it; the SDK does not change it.            |
| `{ uri }`                                                        | A strong reference to an existing record of any type. Its CID is read before the write. |

The SDK never creates a document record. If you want a Leaflet document stored as its own record, create it yourself and pass its URI.

### Browser and Node

In a browser, pass the `File` from an `<input type="file">` wherever a `Blob` is accepted (a new location's `{ blob }`, a tag's `referenceDocument`). In Node, make a `Blob` that carries its type; the SDK cannot guess it:

```ts
import { openAsBlob } from "node:fs";
import { createFeature } from "@hypercerts-org/sdk/feature";

await createFeature(context, {
  title: "Phobjikha restoration zone",
  locations: [
    {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "geojson-polygon",
      location: { blob: await openAsBlob("./zone.geojson", { type: "application/geo+json" }) },
    },
  ],
});
```

Blobs are uploaded before the write and are not part of it; see [Atomicity and uploads](./creating-activities.md#atomicity-and-uploads). For a Feature, the OAuth session needs the `create` permission on the Feature, vocabulary tag and location collections the call writes to.

## Failures

| Error                      | Means                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TypeError`                | The input is invalid, including a dot in a key, a wrong record type, duplicate new keys and too many records. Nothing was written. |
| `RecordAlreadyExistsError` | A new vocabulary tag's key is taken. Nothing was written; `uri` names the tag in the way.                                          |
| `WriteRejectedError`       | The PDS answered with a 4xx. No record was created.                                                                                |
| `WriteOutcomeUnknownError` | No usable answer (network, timeout, 5xx). The records may exist. `attempted` lists every URI. The SDK does not retry.              |
| `WriteResultMismatchError` | The PDS committed the records but reported different URIs or CIDs than the SDK computed.                                           |

After a `WriteOutcomeUnknownError` from `createFeature`, check the URIs before trying again: a second call creates a second Feature under a new key. See [Failures](./creating-activities.md#failures).

## Not covered

Signatures, reusing an already uploaded blob reference, updating or deleting records, creating Leaflet document records, evaluating or checking CEL expressions, and vocabulary registries or governance are not part of these functions.
