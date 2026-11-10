---
"@hypercerts-org/sdk": minor
---

- Add `createOrganization` at `@hypercerts-org/sdk/organization`: creates the account's organization record, its profile if missing (`profileIfMissing`) and new locations in one atomic commit.
- An existing profile is reused unchanged (`profile.disposition` is `"reused"`); an existing organization throws `OrganizationAlreadyExistsError`. Existing locations are passed as `{ uri }`.
- The commit is rejected with `WriteRejectedError` (`code` `"InvalidSwap"`) if the account was written to after the profile and organization were read; nothing is written.
