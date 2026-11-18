---
"@hypercerts-org/sdk": minor
---

- Add `addActivityToCollection` at `@hypercerts-org/sdk/collection` and `addActivityToProject` at `@hypercerts-org/sdk/project`: add a new Activity (`{ activity }`) or an existing one (`{ uri }`) to your own Collection or Project, with an optional `weight`, in one `applyWrites` commit.
- `addActivityToProject` throws `TypeError` if the Collection's type is not `project`.
- The commit is rejected with `WriteRejectedError` (`code` `"InvalidSwap"`) if the account was written to after the repository's latest commit was read; nothing is written.
