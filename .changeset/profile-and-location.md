---
"@hypercerts-org/sdk": minor
---

- Add `createProfile` at `@hypercerts-org/sdk/actor`. It creates the account's `app.certified.actor.profile` record at `self`, uploading `Blob` avatars and banners.
- `createProfile` never overwrites: if the account already has a profile it throws `ProfileAlreadyExistsError` (a `WriteRejectedError`), including when two calls race.
- Add `createLocation` at `@hypercerts-org/sdk/location`. `LocationInput` and `LocationValue` are still exported from `@hypercerts-org/sdk/activity`.
