---
"@hypercerts-org/sdk": minor
---

- Add `followAccount`, `followEntity`, `like` and `repost` at `@hypercerts-org/sdk/social`, with an optional `via` record URI that the SDK pins.
- Add `unfollowAccount`, `unfollowEntity`, `unlike` and `unrepost`. They delete your own record by its URI (`followUri`, `likeUri`, `repostUri`) and return `void`.
- The undo functions throw `TypeError` before sending if the URI is in another collection or account, and take an optional `cid` that makes the PDS delete only if the record still has it.
