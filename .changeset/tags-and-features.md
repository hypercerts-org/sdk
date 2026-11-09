---
"@hypercerts-org/sdk": minor
---

- Add `createVocabularyTag` and `createWorkScopeTag` at `@hypercerts-org/sdk/tag`, and `createFeature` at `@hypercerts-org/sdk/feature`.
- A vocabulary tag's record key is `<category>.<key>`. A taken key throws the new `RecordAlreadyExistsError`, which `ProfileAlreadyExistsError` now extends.
- Tags and Features take a new record or `{ uri }` for every link (`broader`, `parent`, `supersededBy`, `tags`, `locations`), all created in one `applyWrites`.
- `createActivity` accepts a CEL `workScope` (`{ expression, usedTags, version? }`) and creates its new work-scope tags in the same write.
- A call that would create more than 200 records throws a `TypeError` before anything is uploaded or written.
