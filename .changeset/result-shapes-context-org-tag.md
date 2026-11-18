---
"@hypercerts-org/sdk": minor
---

- Breaking: `createOrganization` returns the organization's `uri` and `cid` at the top (`result.uri`) instead of under `organization`; `profile`, `location`, ... stay beside them.
- Breaking: `createAttachment`, `createEvaluation` and `createAcknowledgement` no longer return a top-level `created: true`. Nested entries keep `created`.
- Breaking: `createEvaluation` takes `evaluators` and `createMeasurement` takes `measurers` as `{ did }[]` instead of DID strings.
- Breaking: rename the result types `MeasurementResult`, `VocabularyTagResult` and `WorkScopeTagResult` to `CreateMeasurementResult`, `CreateVocabularyTagResult` and `CreateWorkScopeTagResult`.
