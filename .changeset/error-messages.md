---
"@hypercerts-org/sdk": patch
---

- `createOrganization` throws `OrganizationAlreadyExistsError` when another writer creates the organization between its read and its write, instead of a generic `WriteRejectedError`.
- Failed reads of a `via` or like/repost subject name the operation you called, not `resolveRecordRef`.
- A failed blob upload inside a `create*` operation no longer repeats the `uploadBlob:` prefix in its message.
