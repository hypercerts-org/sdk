# Collection domain (`@hypercerts-org/sdk/collection`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling, and [activity.md](activity.md) for the `activity` input. Every example assumes `context` from `createSDKContext`.

## createActivityInCollection

`createActivityInCollection(context, { collectionUri, activity, itemWeight? })` creates a **new** Activity (the same input as `createActivity`: new, `{ uri }` and `{ inline }` supporting values, `image`) and appends it to an **existing** `org.hypercerts.collection` record in your repo, in one `applyWrites` commit. The Activity, its new supporting records and the new Collection version all exist afterwards, or none of it does.

```ts
import { createActivityInCollection } from "@hypercerts-org/sdk/collection";

const { activity, collection } = await createActivityInCollection(context, {
  collectionUri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8", // placeholder: one of your own
  activity: {
    title: "Reforestation in the Phobjikha valley",
    shortDescription: "Planting 5,000 native trees.",
    rights: { uri: "at://did:plc:abc123/org.hypercerts.claim.rights/3k2a4b5c6d7e8" }, // reused
  },
  itemWeight: "2", // optional positive decimal string, like a contributor's weight
});
// activity: what createActivity returns. collection: { uri, cid }, the same URI with the new version's CID.
```

- `collectionUri` must be `at://<did>/org.hypercerts.collection/<rkey>` with **your** DID. Another type of record, a handle, or another account's Collection throws `TypeError` before anything is sent.
- The item is appended last. Everything else in the Collection (`createdAt`, existing items, unknown fields, `signatures`) is kept as it was. `signatures` is not re-signed: after the append, an earlier signature no longer matches the content.
- A Collection that holds 1000 items is full: `Error`, nothing written. A Collection that does not exist or is not a valid `org.hypercerts.collection` record: `Error`, nothing written.
- Nothing is deduplicated: a second call creates a second Activity and a second item.
- Not supported: creating or editing Collections, adding an existing Activity, adding to another account's Collection, nested Collections.

## Concurrent writes (`InvalidSwap`)

The write is conditional on the account not having changed since the Collection was read, so a concurrent change to its `items` cannot be overwritten with a stale list. When it did change you get `WriteRejectedError` with `code === "InvalidSwap"`: see [Concurrent changes](../SKILL.md#concurrent-changes-invalidswap) for the rule and the retry example.

Any other `WriteRejectedError` (4xx) is not fixed by calling again. After `WriteOutcomeUnknownError`, `attempted` lists the new records and, last, the Collection: check the Activity and whether the Collection lists it before retrying, or you create a second Activity.

## Uploads are outside the commit

`Blob`/`File` values are uploaded before the repository is read and are not rolled back if the write fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write). A bad URI, another account's Collection, a missing, invalid or full Collection, or an invalid `activity` fails before any upload (the Collection is read once up front, then again after the latest commit for the guarded write).

## `CreateActivityInCollectionInput`

| Field           | Type            | Notes                                                                                                   |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `collectionUri` | `string`        | Required. `at://<your did>/org.hypercerts.collection/<rkey>`. Must already exist and hold under 1000 items. |
| `activity`      | `ActivityInput` | Required. The same input as `createActivity`; see [activity.md](activity.md). Always creates a new Activity. |
| `itemWeight`    | `string`        | Optional. Positive decimal string, like a contributor's weight. Left out of the item when omitted.      |
