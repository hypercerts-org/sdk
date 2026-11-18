---
"@hypercerts-org/sdk": minor
---

- `addActivityToCollection` and `addActivityToProject` with `activity: { uri }` now replace the Collection with one `putRecord` guarded by the Collection's own version, so unrelated writes to the account no longer fail it with `InvalidSwap`; only a change to the Collection does.
- A new Activity still uses one `applyWrites` guarded by the repository's head commit.
