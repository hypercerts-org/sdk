---
"@hypercerts-org/sdk": minor
---

- Add `createBadgeDefinition`, `awardBadge` and `respondToBadgeAward` at `@hypercerts-org/sdk/badge`.
- `awardBadge` creates a new definition and the award in one `applyWrites` commit, or reuses an existing definition, and checks the signed-in account against its `allowedIssuers`.
- `respondToBadgeAward` only creates a response for the award's recipient: the account it is for, or the account whose repository holds the record it is for.
