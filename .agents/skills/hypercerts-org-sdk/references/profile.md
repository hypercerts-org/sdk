# Profile domain (`@hypercerts-org/sdk/actor`)

`createProfile(context, input)` creates the signed-in account's profile: the single `app.certified.actor.profile` record at key `self`. It returns `{ uri, cid }`.

It only creates. It never overwrites or merges into an existing profile, and the SDK has no operation that updates one yet.

## OAuth scope

An OAuth session needs both `create` and `update` on `app.certified.actor.profile`:

```
repo:app.certified.actor.profile?action=create&action=update
```

`createProfile` writes with `putRecord`, and the PDS checks both permissions for a `putRecord`, even though this call never overwrites. With only `create` the PDS answers 403 and you get `WriteRejectedError`.

## Examples

### Minimal

```ts
import { createProfile } from "@hypercerts-org/sdk/actor";

// `context` comes from createSDKContext.
const profile = await createProfile(context, { displayName: "Alice" });
console.log(profile.uri); // at://<did>/app.certified.actor.profile/self
```

### With images

```ts
// `avatarFile` is a File, for example from an <input type="file">.
await createProfile(context, {
  displayName: "Phobjikha Conservation",
  description: "Planting trees in the Phobjikha valley.",
  pronouns: "they/them",
  langs: ["en"], // the language the text is written in
  website: "https://example.org",
  avatar: avatarFile, // uploaded
  banner: "https://example.org/banner.png", // stored as a URL, never fetched
});
```

### The profile may already exist

```ts
import { createProfile, ProfileAlreadyExistsError } from "@hypercerts-org/sdk/actor";

try {
  await createProfile(context, { displayName: "Alice" });
} catch (error) {
  if (!(error instanceof ProfileAlreadyExistsError)) throw error;
  // The account already has a profile. Nothing was changed, and the SDK cannot update it.
}
```

### Retrying after an unknown outcome

```ts
import {
  createProfile,
  ProfileAlreadyExistsError,
  WriteOutcomeUnknownError,
} from "@hypercerts-org/sdk/actor";

try {
  await createProfile(context, input);
} catch (error) {
  if (!(error instanceof WriteOutcomeUnknownError)) throw error;
  // Safe to call again: the key is fixed and the profile is only created if absent.
  try {
    await createProfile(context, input);
  } catch (retryError) {
    // The profile exists, most likely from the first attempt. Its CID is not
    // `retryError.attempted[0].cid`: `createdAt` differs between calls. Read the record if you need it.
    if (!(retryError instanceof ProfileAlreadyExistsError)) throw retryError;
  }
}
```

## Errors

- `ProfileAlreadyExistsError`: the account already has a profile; nothing changed. It extends `WriteRejectedError` (`status` 400, `code` `InvalidSwap`), so check for it first.
- The other `Write*` errors behave as described in "Handle failures" in [SKILL.md](../SKILL.md). Unlike other operations, retrying after `WriteOutcomeUnknownError` cannot create a duplicate.

## Pitfalls

- Two simultaneous calls can't overwrite each other: one creates, the other throws `ProfileAlreadyExistsError`. This relies on `swapRecord: null` and was verified against the reference PDS only.
- An avatar or banner `Blob` is uploaded before the write. If the write fails, including because the profile already exists, the blob is left unreferenced.
- More than three `langs`, or an image that is not JPEG, PNG or WebP, throws `TypeError` before anything is written.

## `ProfileInput` (`app.certified.actor.profile`)

Every field is optional.

| Field         | Type             | Notes                                                      |
| ------------- | ---------------- | ---------------------------------------------------------- |
| `displayName` | `string`         | Max 64 graphemes.                                          |
| `description` | `string`         | Max 256 graphemes.                                         |
| `pronouns`    | `string`         | Free-form. Max 20 graphemes.                               |
| `langs`       | `string[]`       | BCP-47 tags of the languages the text is written in, up to 3. Usually one; list more only when the text mixes languages. |
| `website`     | `string`         | A URL.                                                     |
| `avatar`      | `Blob \| string` | JPEG/PNG/WebP up to 5 MB (uploaded), or a URL. An organization should use its brandmark. |
| `banner`      | `Blob \| string` | JPEG/PNG/WebP up to 10 MB (uploaded), or a URL.            |
| `createdAt`   | `string`         | ISO 8601 date-time. Defaults to the time of the call.      |
