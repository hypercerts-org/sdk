---
"@hypercerts-org/sdk": minor
---

- Add `followAccount`, `followEntity`, `like` and `repost` at `@hypercerts-org/sdk/social`. They take `target: { did }` (account) or `target: { uri }` (record), and an optional `via: { uri }` that the SDK pins.
- Add `unfollowAccount`, `unfollowEntity`, `unlike` and `unrepost`. They delete your own record, passed as `{ follow }`, `{ like }` or `{ repost }` (`{ uri, cid? }`, so the create result works as it is), and return `void`.
- The undo functions throw `TypeError` before sending if the URI is in another collection or account, and an optional `cid` makes the PDS delete only if the record still has it.
