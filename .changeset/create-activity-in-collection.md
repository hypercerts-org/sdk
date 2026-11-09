---
"@hypercerts-org/sdk": minor
---

- Add `createActivityInCollection` at `@hypercerts-org/sdk/collection`: creates an Activity and adds it to an existing Collection in one `applyWrites` commit.
- It rejects the commit with `WriteRejectedError` (`code` `"InvalidSwap"`) if the account was written to after the Collection was read; nothing is written.
