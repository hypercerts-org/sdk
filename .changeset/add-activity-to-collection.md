---
"@hypercerts-org/sdk": minor
---

- Add `addActivityToCollection` at `@hypercerts-org/sdk/collection` and `addActivityToProject` at `@hypercerts-org/sdk/project`: add an Activity to your own Collection or Project, with an optional `weight`, in one `applyWrites` commit. Pass `collection: { uri }` or `project: { uri }`, and `activity` as the data of a new Activity or `{ uri }` of an existing one. The result is the updated record's `uri` and `cid`, plus `activity`.
- `addActivityToProject` throws `TypeError` if the Collection's type is not `project`.
- The commit is rejected with `WriteRejectedError` (`code` `"InvalidSwap"`) if the account was written to after the repository's latest commit was read; nothing is written.
