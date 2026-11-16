---
"@hypercerts-org/sdk": minor
---

- Add `followAccount`, `followEntity`, `like` and `repost` at `@hypercerts-org/sdk/social`, with an optional `via` record URI that the SDK pins.
- Add `unfollowAccount`, `unfollowEntity`, `unlike` and `unrepost`. They scan the account's own repository and return `UndoResult` (`deleted` or `not-found`); with several matching records nothing is deleted and they throw `AmbiguousMatchError`, whose `matches` lists the records.
- Deletions are guarded by the record's CID; a concurrent change throws `WriteRejectedError` with `code` `"InvalidSwap"`.
