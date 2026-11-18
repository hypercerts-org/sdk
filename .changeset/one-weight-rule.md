---
"@hypercerts-org/sdk": patch
---

- Weights follow one rule: a positive decimal string within the lexicon's length limit (100 characters; 50 for `respondToBadgeAward`). A too-long activity contributor or collection item weight now throws a `TypeError` naming the field before any request, instead of failing later at the lexicon check.
- `respondToBadgeAward` with a weight over 50 characters now throws a `TypeError` ("must be at most 50 characters") before any request, instead of a lexicon-validation error.
