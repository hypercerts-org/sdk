---
"@hypercerts-org/sdk": minor
---

- Add `createCollection` at `@hypercerts-org/sdk/collection`: creates a Collection with its items, location and tags in one `applyWrites` commit.
- An item is `{ activity }`, `{ feature }` or `{ collection }` (new, nested to any depth) or `{ uri }` (an existing Activity, Feature or Collection, reused unchanged), with an optional `weight` kept as written.
- Failed writes throw `WriteRejectedError` (nothing created) or `WriteOutcomeUnknownError` (lists every attempted record, the Collection last); the SDK never retries.
