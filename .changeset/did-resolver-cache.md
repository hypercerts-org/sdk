---
"@hypercerts-org/sdk": minor
---

- Cache DID lookups per context, so repeated reads of another account's record no longer fetch from plc.directory each time.
- Add the `didResolver` option to `createSDKContext` and the `DidDocumentResolver` type. Pass `oauthClient.identityResolver` or your own resolver.
