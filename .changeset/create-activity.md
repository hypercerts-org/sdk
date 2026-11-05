---
"@hypercerts-org/sdk": minor
---

- Add `createActivity`, `createRights`, `createContributorInformation` and `createContribution` at `@hypercerts-org/sdk/activity`.
- `createActivity` creates an Activity and its new linked records in one `applyWrites` request, reusing existing records by URI.
- Failed writes throw `WriteRejectedError` (nothing created) or `WriteOutcomeUnknownError` (outcome unknown, lists attempted URIs); the SDK never retries.
- Add `@atproto/lex-cbor` as a dependency.
