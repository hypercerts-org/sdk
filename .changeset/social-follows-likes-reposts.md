---
"@hypercerts-org/sdk": minor
---

- Add `followAccount`, `followEntity`, `like` and `repost` at `@hypercerts-org/sdk/social`, with an optional `via` record URI that the SDK pins.
- Add `unfollowAccount`, `unfollowEntity`, `unlike` and `unrepost`. They scan the account's own repository and return `UndoResult` (`deleted`, `not-found` or `ambiguous`); with several matching records nothing is deleted.
- Deletions are guarded by the record's CID; a concurrent change throws `WriteRejectedError` with `code` `"InvalidSwap"`.
