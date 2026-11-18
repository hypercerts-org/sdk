---
"@hypercerts-org/sdk": minor
---

- `createOrganization` returns the organization's `uri` and `cid` at the top (`result.uri`), with `profile`, `location`, ... beside them.
- `createAttachment`, `createEvaluation` and `createAcknowledgement` return a `StrongRef` with no top-level `created`; nested entries carry `created`.
- `createEvaluation` takes `evaluators` and `createMeasurement` takes `measurers` as `{ did }[]`.
- Result types are named `CreateMeasurementResult`, `CreateVocabularyTagResult` and `CreateWorkScopeTagResult`.
