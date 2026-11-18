---
"@hypercerts-org/sdk": minor
---

- Every write function takes an optional last argument `{ repo }` (`WriteOptions`); an organization's DID writes to its repository through the Certified Group Service.
- `uploadBlob` takes `repo` in its options.
- `createSDKContext` takes `cgs: { url, did }`; an organization write without it throws a `TypeError` before any request.
- New `PartialWriteError` (`written`, `failed`, `failure`, `notAttempted`) when an organization write fails after at least one record landed.
- Organization writes send one request per record and never use `swapCommit`.
- `cgs.did` is the bare DID; the SDK requests tokens for `<cgs.did>#certified_group_service`. OAuth needs one `rpc:` scope per CGS method (see the README).
