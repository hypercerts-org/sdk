# Collection domain (`@hypercerts-org/sdk/collection`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling, [activity.md](activity.md) for an `activity` item, [feature.md](feature.md) for a `feature` item and [tag.md](tag.md) / [location.md](location.md) for tags and locations. Every example assumes `context` from `createSDKContext`.

Two operations: `createCollection` creates a **new** Collection with its items; `addActivityToCollection` adds an Activity (new or existing) to a Collection that **already exists**.

For `type: "project"`, prefer `createProject` ([project.md](project.md)): `createCollection` can create a Project with Activities (and Features or child Collections) but also one with no Activity at all, while `createProject` guarantees it has at least one Activity. Use `createCollection` when a Project needs Features or child Collections. To publish work, create a project with `createProject`: an Activity on its own may not show up or work in other apps in the ecosystem, and apps expect a project that holds its activities.

## createCollection

`createCollection(context, input)` creates an `org.hypercerts.collection` (TID key) and every new record in it, in one `applyWrites` commit: the Collection, new Activities (with their rights, locations, contributors, ...), Features, child Collections, locations and tags. All of it exists afterwards, or none does.

```ts
import { createCollection } from "@hypercerts-org/sdk/collection";

const collection = await createCollection(context, {
  type: "portfolio",
  title: "Phobjikha valley restoration",
  description: "Everything we do in the valley.", // string | Leaflet document | { uri } of any record
  avatar: "https://example.org/valley.png", // URL string, or an image Blob/File to upload
  location: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // reused
  tags: [{ category: "theme", key: "forest", name: "Forest", status: "accepted" }], // created
  items: [
    { activity: { title: "Reforestation", shortDescription: "Planting 5,000 trees." }, weight: "2" }, // created
    { feature: { type: "zone", title: "Valley floor zone" } }, // created
    { collection: { title: "Phase 2", items: [] } }, // created, can hold items too
    { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8", weight: "0.5" }, // reused
  ],
});
collection.items[0]; // { uri, cid, type: "activity", created: true, locations: [], contributors: [] }
collection.items[3]; // { uri, cid, type: "activity", created: false }
```

- An item is **exactly one** of `{ activity }`, `{ feature }`, `{ collection }` (the data of a new record, same input as `createActivity`, `createFeature` and `createCollection`) or `{ uri }`, plus an optional `weight`. The SDK never guesses from the fields: a bare Activity (`{ title, shortDescription }`) is a `TypeError`.
- `{ uri }` must be an Activity, Feature or Collection with a DID (`at://<did>/<collection>/<rkey>`). It is read for its CID and reused unchanged; it may belong to another account if public. Another account's PDS is found with the context's `didResolver` ([SKILL.md](../SKILL.md#2-create-the-context-once)). Another record type, or a handle, is a `TypeError` naming the item.
- `weight` is a positive decimal string (`"2"`, `"0.50"`), stored exactly as you pass it, at most 100 characters. Weights need not add up to anything.
- Order is kept. Nothing is deduplicated or searched for: the same `{ uri }` twice gives two items, the same data twice gives two records.
- `location` and `tags` take new records or `{ uri }` like in `createFeature`. A new tag's key is `<category>.<key>`: a taken key throws `RecordAlreadyExistsError` before anything is uploaded or written, and two new tags with the same key anywhere in the call are a `TypeError` (create it first and pass its `uri`).
- `description`: a string and a Leaflet document (it needs `$type: "pub.leaflet.pages.linearDocument"`) stay inline in the Collection; `{ uri }` becomes a strong reference. The SDK never creates a document record.
- `avatar` (image up to 5 MB) and `banner` (image up to 10 MB): a URL string is stored as it is, a `Blob`/`File` is uploaded.
- The result mirrors the input: `result.items[i]`, `result.tags[i]` and `result.location` say what was created (`created: true`) or reused (`created: false`). Narrow an item on `created` and `type` to reach the nested results (`item.locations`, `item.items`, ...).
- One write holds at most 200 records, the Collection and every nested Activity, location and tag included. A bigger call throws a `TypeError` before anything is read or uploaded; it is never split. Create some records first and pass their `uri`.
- The session needs `create` on every collection the call writes to.

### Order of work and failures

Validate all input and count the records, read every `{ uri }` and every new tag's key, upload files, build the records, one write. A bad item, a wrong record type, too many records or an unreadable `{ uri }` fails (`TypeError` or `Error`) before any upload. A file the image limits reject, or a record the lexicon rejects (a title that is too long), is only found when that record is built, so files of other records may already be uploaded. Uploads are not rolled back if the write fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write).

Errors are as in [Handle failures](../SKILL.md#6-handle-failures). After `WriteOutcomeUnknownError`, `attempted` lists every new record, children before the records that point at them, the Collection **last**. The write is all-or-nothing, so check the Collection with `getRecord`; if it exists, everything does. **Do not retry blindly**: it would create every record again under new keys.

### `CollectionInput`

| Field                    | Type                                     | Notes                                                                           |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `title`                  | `string`                                 | Required. At most 800 characters and 80 graphemes.                              |
| `type`                   | `string`                                 | `favorites`, `project`, `portfolio`, `program`; other values accepted.          |
| `shortDescription`       | `string`                                 | At most 300 graphemes. `shortDescriptionFacets` holds its rich-text facets.     |
| `description`            | `string \| LeafletDocument \| { uri }`   | Inline text or document, or a reference to a record of any type.                |
| `langs`                  | `string[]`                               | Up to three BCP-47 tags.                                                        |
| `avatar` / `banner`      | `string \| Blob`                          | URL stored as is, or an image uploaded.                                         |
| `location`               | `LocationInput \| { uri }`               | New or existing `app.certified.location`.                                       |
| `tags`                   | `(VocabularyTagInput \| { uri })[]`       | At most 20; vocabulary tags only (a work-scope tag URI throws).                 |
| `items`                  | `CollectionItemInput[]`                  | At most 1000. `{ activity \| feature \| collection \| uri, weight? }`.         |
| `createdAt`              | `string`                                 | ISO 8601; defaults to the time of the call, for every new record.               |

Not supported: `signatures`, adding items other than an Activity to a Collection that exists (see below), changing an existing record.

## addActivityToCollection

`addActivityToCollection(context, { collection: { uri }, activity, weight? })` appends an Activity to an **existing** `org.hypercerts.collection` record in your repo, in one `applyWrites` commit. `collection` is `{ uri }` of the Collection, never a bare string. `activity` is the data of a new Activity (the same input as `createActivity`; it and its new supporting records are created) or `{ uri }` of an existing Activity (reused unchanged). All of it exists afterwards, or none of it does.

```ts
import { addActivityToCollection } from "@hypercerts-org/sdk/collection";

const collection = { uri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8" }; // placeholder: one of your own

// A new Activity, with its own rights record reused.
const added = await addActivityToCollection(context, {
  collection,
  activity: {
    title: "Reforestation in the Phobjikha valley",
    shortDescription: "Planting 5,000 native trees.",
    rights: { uri: "at://did:plc:abc123/org.hypercerts.claim.rights/3k2a4b5c6d7e8" }, // reused
  },
  weight: "2", // optional positive decimal string, like a contributor's weight
});
added.activity; // { uri, cid, created: true, locations: [], contributors: [] }
added.uri; // the Collection's URI, unchanged
added.cid; // the CID of the Collection's new version

// An existing Activity.
await addActivityToCollection(context, {
  collection,
  activity: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
});
```

- `collection.uri` must be `at://<did>/org.hypercerts.collection/<rkey>` with **your** DID. Another type of record, a handle, or another account's Collection throws `TypeError` before anything is sent.
- `activity` is the Activity's own data or `{ uri }`, not wrapped: the old `activity: { activity: {...} }` is a `TypeError`, as is `uri` mixed with Activity fields. `weight` goes next to `activity`, not inside it, and is a positive decimal string of at most 100 characters.
- `activity: { uri }` must be an Activity (a Feature or a Collection is a `TypeError`) with a DID. It is read once for its CID, which the item stores (a strong reference), and never changed. It may belong to another account if public; the PDS is found with the context's `didResolver` ([SKILL.md](../SKILL.md#2-create-the-context-once)).
- The item is appended last. Everything else in the Collection (`createdAt`, existing items, unknown fields, `signatures`) is kept as it was. `signatures` is not re-signed: after the append, an earlier signature no longer matches the content.
- A Collection that holds 1000 items is full: `Error`, nothing written. A Collection that does not exist or is not a valid `org.hypercerts.collection` record: `Error`, nothing written.
- Nothing is deduplicated: a second call creates a second Activity and a second item, and the same `{ uri }` twice gives two items.
- Not supported: adding a Feature or a child Collection to an existing Collection, and adding to another account's Collection. To create a whole new Collection, use `createCollection`.
- The result is a flat strong reference to the **updated Collection** (`uri` unchanged, `cid` of its new version) plus `activity`, which is `created: true` with the nested results of `createActivity`, or `created: false` for a `{ uri }`. The Collection is the main record because the call changes it; the Activity may only be reused.
- For a Collection of type `project`, `addActivityToProject` ([project.md](project.md)) also checks the type.

### Concurrent writes (`InvalidSwap`)

The write is conditional on the account not having changed since the Collection was read, so a concurrent change to its `items` cannot be overwritten with a stale list. When it did change you get `WriteRejectedError` with `code === "InvalidSwap"`: see [Concurrent changes](../SKILL.md#concurrent-changes-invalidswap) for the rule and the retry example.

Any other `WriteRejectedError` (4xx) is not fixed by calling again. After `WriteOutcomeUnknownError`, `attempted` lists the new records and, last, the Collection (only the Collection for a `{ uri }`): read the Collection and check whether its CID changed since you read it before retrying, or you add a second item. An existing Activity may already be listed, so its presence proves nothing; if later writes make the CID check impossible, reconcile `items` by hand.

### Uploads are outside the commit

`Blob`/`File` values are uploaded before the repository is read and are not rolled back if the write fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write). A bad URI, a bad `activity`, another account's Collection, or a missing, invalid or full Collection fails before any upload (the Collection is read once up front, then again after the latest commit for the guarded write).

### `AddActivityToCollectionInput`

| Field           | Type                          | Notes                                                                                                         |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `collection`    | `{ uri }`                     | Required. `at://<your did>/org.hypercerts.collection/<rkey>`. Must already exist and hold under 1000 items.  |
| `activity`      | `ActivityInput \| { uri }`    | Required. A new Activity (the input of `createActivity`, see [activity.md](activity.md)) or `{ uri }` of an existing one. |
| `weight`        | `string`                      | Optional. Positive decimal string, at most 100 characters. Left out of the item when omitted.                 |
