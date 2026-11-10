---
"@hypercerts-org/sdk": minor
---

- Add `createAttachment`, `createMeasurement`, `createEvaluation` and `createAcknowledgement` at `@hypercerts-org/sdk/context`.
- Attachments and evaluations upload `Blob` content for you; subjects are `{ uri }` of any existing record and are never modified.
- Locations, vocabulary tags and measurements are new data or `{ uri }`, and are created in the same `applyWrites` as the record that points at them.
- Measured values and scores are decimal strings; a JavaScript number throws instead of being converted.
- Acknowledgements are always written to the signed-in account's repo.
