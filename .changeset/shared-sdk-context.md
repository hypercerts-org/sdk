---
"@hypercerts-org/sdk": minor
---

Add `createSDKContext`, which takes an authenticated `@atproto/lex` `Client` and returns the shared context that SDK operations receive as their first argument. `@atproto/lex` is a peer dependency (`^0.4.4`).
