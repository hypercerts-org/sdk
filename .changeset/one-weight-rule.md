---
"@hypercerts-org/sdk": patch
---

- Weights are checked up front by one rule: a positive decimal string within the lexicon's length limit (100 characters; 50 for `respondToBadgeAward`). A too-long contributor, collection item or `addActivityTo*` weight now throws a `TypeError` naming the field before any request, instead of failing later at the lexicon check.
