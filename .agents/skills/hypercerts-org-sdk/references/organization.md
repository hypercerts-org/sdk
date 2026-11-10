# Organization domain (`@hypercerts-org/sdk/organization`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

`createOrganization(context, { organization, profileIfMissing? })` creates the signed-in account's organization record (`app.certified.actor.organization`, key `self`) and, if the account has no profile yet, its profile (`app.certified.actor.profile`, see [profile.md](profile.md)), together with any new locations (see [location.md](location.md)), in one `applyWrites` commit. It creates records in the account you are signed in as; it does not create accounts.

```ts
import { createOrganization } from "@hypercerts-org/sdk/organization";

// `logoFile` is a File, for example from an <input type="file">.
const { organization, profile, location, additionalLocations } = await createOrganization(context, {
  organization: {
    legalName: "Phobjikha Conservation Society",
    organizationType: ["ngo"],
    urls: [{ url: "https://example.org/donate", label: "Donate" }],
    logo: logoFile, // uploaded; a URL string is stored as it is, never fetched
    longDescription: "We plant native trees in the Phobjikha valley.",
    location: {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "country-code",
      location: { string: "BT" },
    }, // new
    additionalLocations: [
      { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // existing, reused
    ],
  },
  // Used only when the account has no profile. Ignored (and its images not uploaded) otherwise.
  profileIfMissing: { displayName: "Phobjikha Conservation", avatar: avatarFile },
});
organization; // { uri, cid }
profile; // { uri, cid, created: true } (false when the account already had one)
location; // { uri, cid, created: true }
additionalLocations; // [{ uri, cid, created: false }]
```

## The profile

The display name, short description, website, avatar and banner belong to the **profile**, not the organization. Put them in `profileIfMissing`. The organization record holds only organization fields (legal name, logo, public email, types, URLs, locations, founding date, long description, languages, visibility).

| Account state                           | What happens                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Has a profile                           | Reused exactly as it is: `created: false`. `profileIfMissing` is **not** an update and its images are not uploaded. It is still validated, so a typo in it throws either way. |
| No profile, `profileIfMissing` given    | Created in the same commit: `created: true`.                                         |
| No profile, no `profileIfMissing`       | `TypeError` naming `profileIfMissing`. Nothing is uploaded or written. The SDK never creates an empty profile. |

There is no operation that updates a profile or an organization.

## The organization may already exist

```ts
import { createOrganization, OrganizationAlreadyExistsError } from "@hypercerts-org/sdk/organization";

try {
  await createOrganization(context, input);
} catch (error) {
  if (!(error instanceof OrganizationAlreadyExistsError)) throw error;
  // Nothing was uploaded or written. `error.uri` is the existing record; the SDK cannot update it.
}
```

`OrganizationAlreadyExistsError` extends `RecordAlreadyExistsError`, which extends `WriteRejectedError` (`status` 400, `code` `"InvalidSwap"`), so check for it first. It is thrown before any upload.

A failed read of the profile or the organization (network error, 5xx, 403) throws an `Error`. It is never taken as "absent".

## Locations and the long description

- `location` (primary) and each entry of `additionalLocations` are either the fields of a **new** location or `{ uri }` of an **existing** `app.certified.location`, which is read and reused unchanged. A bare string such as `location: "at://…"` throws `TypeError`; write `{ uri: "at://…" }`.
- Order is kept, the primary location stays separate from the additional ones, and nothing is deduplicated: the SDK does not notice the primary location repeated in `additionalLocations`.
- `longDescription` is a string (stored inline as plain text or Markdown), a Leaflet document (it needs `$type: "pub.leaflet.pages.linearDocument"`, stored inline as it is), or `{ uri }` of an existing record of any type (stored as a strong reference with the CID read first). The SDK never creates a document record. The result's `longDescription` carries the pinned reference only for `{ uri }`.

## Concurrent writes (`InvalidSwap`)

The write is conditional on the account not having changed since the profile and the organization were read, so another call creating either one in between cannot make "reuse or create the profile" stale. When it did change you get `WriteRejectedError` with `code === "InvalidSwap"`: see [Concurrent changes](../SKILL.md#concurrent-changes-invalidswap) for the rule and the retry example. Calling again reads everything afresh and then throws `OrganizationAlreadyExistsError` if the other writer created the organization.

## After `WriteOutcomeUnknownError`

`attempted` lists the profile (if it would be created), the new locations and, last, the organization. Calling `createOrganization` again is safe, even though new locations get fresh record keys: the call reads the organization first, so if the first attempt succeeded it throws `OrganizationAlreadyExistsError` before writing anything (no second set of locations or profile), and if it did not, nothing exists and the call creates everything. The records are those of the first error's `attempted`, not of the second call.

## Uploads are outside the commit

A `Blob`/`File` logo, a new location's `{ blob }` and (when the profile is created) the profile's images are uploaded after the reads and before the write. If the write is refused, they stay unreferenced (a PDS usually deletes them later, not guaranteed). An invalid input, an existing organization, a missing profile without `profileIfMissing`, a failed read, an unreadable `{ uri }` or more than 200 new records fails before any upload. A lexicon rule that rejects a record (for example more than three `langs`) is only found after the uploads.

## Pitfalls

- The session needs `create` on `app.certified.actor.organization`, and on `app.certified.actor.profile` and `app.certified.location` when the call creates them. No `update` is needed.
- One write holds at most 200 records: the organization, a created profile and every new location. More is a `TypeError`; create some locations first and pass their `{ uri }`.
- An explicit `profileIfMissing: {}` is data: it creates a profile with only `createdAt`.

## `OrganizationInput` (`app.certified.actor.organization`)

Every field is optional.

| Field                 | Type                                                  | Notes                                                                                         |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `legalName`           | `string`                                              | Registered legal name. Max 256 graphemes. The public name is the profile's `displayName`.     |
| `publicEmail`         | `string`                                              | Shown publicly. Max 254 characters. Never an internal address.                                |
| `organizationType`    | `string[]`                                            | For example `ngo`, `cooperative`. Max 10, each max 100 graphemes.                             |
| `urls`                | `{ url: string; label?: string }[]`                   | Reference links. The main website is the profile's `website`.                                 |
| `logo`                | `Blob \| string`                                      | JPEG/PNG/WebP up to 5 MB (uploaded), or a URL. The square symbol is the profile's `avatar`.   |
| `location`            | `LocationInput \| { uri }`                            | Primary location: new, or an existing one reused.                                             |
| `additionalLocations` | `(LocationInput \| { uri })[]`                        | Max 1000 by the lexicon, but a write holds 200 records. Do not repeat the primary location.   |
| `foundedDate`         | `string`                                              | ISO 8601 date-time; use midnight UTC.                                                         |
| `longDescription`     | `string \| LeafletDocument \| { uri }`                | See above.                                                                                    |
| `langs`               | `string[]`                                            | BCP-47 tags of the text, up to 3.                                                             |
| `visibility`          | `string`                                              | `public` or `unlisted`; other values are accepted.                                            |
| `createdAt`           | `string`                                              | ISO 8601 date-time. Defaults to the time of the call.                                         |
