---
"@hypercerts-org/sdk": minor
---

- Add `createProject` at `@hypercerts-org/sdk/project`: creates a Project (a Collection of type `project`) with its Activities, location and tags in one `applyWrites` commit.
- `activities` takes `{ activity }` (new) or `{ uri }` (an existing Activity, reused unchanged), each with an optional `weight` kept as written. `type` and `items` are rejected.
- Without `activities`, it creates one default Activity that copies the Project's `title`, `shortDescription`, `shortDescriptionFacets`, `description`, `langs` and `banner` (as `image`; a file over 5 MB is left out) and nothing else; values the Activity cannot hold throw instead of being shortened.
- `createProject` is the recommended way to publish work: an Activity on its own may not show up or work in other apps in the ecosystem.
- Failed writes throw `WriteRejectedError` (nothing created) or `WriteOutcomeUnknownError` (lists every attempted record, the Project last); the SDK never retries.
