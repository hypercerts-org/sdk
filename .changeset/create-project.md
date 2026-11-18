---
"@hypercerts-org/sdk": minor
---

- Add `createProject` at `@hypercerts-org/sdk/project`: creates a Project (a Collection of type `project`) with its Activities, location and tags in one `applyWrites` commit.
- `activities` takes `{ activity, weight? }`, where `activity` is the data of a new Activity or `{ uri }` of an existing one (reused unchanged), and `weight` is kept as written. `type` and `items` are rejected.
- Without `activities`, it creates one default Activity that copies the Project's `title`, `shortDescription`, `shortDescriptionFacets`, `description`, `langs` and `banner` (as `image`; a file up to 5 MB is uploaded once and shared with the Project's `banner`, a larger one is left out) and nothing else; values the Activity cannot hold throw instead of being shortened.
- `createProject` is the recommended way to publish work: an Activity on its own may not show up or work in other apps in the ecosystem.
- Failed writes throw `WriteRejectedError` (nothing created) or `WriteOutcomeUnknownError` (lists every attempted record, the Project last); the SDK never retries.
