---
"@hypercerts-org/sdk": minor
---

- Breaking: `like`, `repost` and `followEntity` take `target: { uri }` instead of `targetUri`, and `followAccount` takes `target: { did }` instead of `targetDid`.
- Breaking: `via` is `{ uri }` instead of a string.
- Breaking: `unlike`, `unrepost`, `unfollowAccount` and `unfollowEntity` take the record the create function returned, `{ like }`, `{ repost }` or `{ follow }` (`{ uri, cid? }`), instead of `likeUri`, `repostUri`, `followUri` and `cid`. `unlike(context, { like: liked })` works as it is.
