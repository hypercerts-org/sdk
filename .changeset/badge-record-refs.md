---
"@hypercerts-org/sdk": minor
---

- Breaking: `respondToBadgeAward` takes `award: { uri }` instead of `awardUri`.
- Breaking: `awardBadge` returns the award's `uri` and `cid` at the top level, next to `definition`, instead of `{ award, definition }`.
