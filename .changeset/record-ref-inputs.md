---
"@hypercerts-org/sdk": minor
---

- **Breaking:** `addActivityToCollection` takes `collection: { uri }` instead of `collectionUri`, and `addActivityToProject` takes `project: { uri }` instead of `projectUri`. `activity` is the data of a new Activity or `{ uri }` of an existing one, no longer wrapped as `{ activity }`. `weight` stays beside it.
- **Breaking:** `createProject` entries are `{ activity, weight? }`; an existing Activity moves under `activity: { uri }`.
- **Breaking:** `addActivityToCollection` and `addActivityToProject` return the updated Collection or Project as `uri` and `cid` on the result, next to `activity`, instead of under `collection` or `project`.
- Remove the `ActivityEntry` type.
