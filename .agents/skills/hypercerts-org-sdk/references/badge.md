# Badge domain (`@hypercerts-org/sdk/badge`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

Three operations that only create records: `createBadgeDefinition` (`app.certified.badge.definition`), `awardBadge` (`app.certified.badge.award`) and `respondToBadgeAward` (`app.certified.badge.response`). There is no operation that deletes, revokes or edits a definition, award or response.

## createBadgeDefinition

`createBadgeDefinition(context, input)` creates one definition in your repo and returns `{ uri, cid }`.

```ts
import { createBadgeDefinition } from "@hypercerts-org/sdk/badge";

const definition = await createBadgeDefinition(context, {
  title: "Verified steward",
  badgeType: "verification", // free text; values outside the lexicon's known set are fine
  description: "Confirmed to manage the land they report on.",
  icon: iconFile, // a PNG, JPEG, WebP or SVG File/Blob of at most 1 MiB, from your app, uploaded for you
  allowedIssuers: ["did:plc:abc123"], // plain DIDs; the SDK stores them as DID objects
});
```

- `allowedIssuers`: omitted means **anyone** may award the badge; `[]` means **no one** may. You do not have to be on the list to create the definition, only to award it.
- `icon` is a `Blob`/`File`, not a URL and not an `uploadBlob` result. A type or size the lexicon refuses throws `TypeError` before anything is uploaded.
- Nothing is deduplicated: two calls create two definitions.

## awardBadge

`awardBadge(context, { definition, subject, note?, url?, validFrom?, validUntil?, createdAt? })` creates an award in your repo and returns `{ award, definition }`.

`definition` is either the fields of a **new** definition (created in the same commit) or `{ uri }` of an **existing** one (read, never rewritten):

```ts
import { awardBadge } from "@hypercerts-org/sdk/badge";

// An existing badge, awarded to an account.
const { award, definition } = await awardBadge(context, {
  definition: { uri: "at://did:plc:abc123/app.certified.badge.definition/3k2a4b5c6d7e8" },
  subject: { did: "did:plc:xyz789" },
  note: "Completed the stewardship course.",
  validUntil: "2027-06-01T00:00:00.000Z",
});
definition.created; // false

// A new badge awarded to a record (any type, any account's repository), one atomic commit.
await awardBadge(context, {
  definition: { title: "Field verified", badgeType: "verification" },
  subject: { uri: "at://did:plc:xyz789/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
});
```

- `subject` is `{ did }` (an account) or `{ uri }` (a record, identified by a DID, not a handle). You never build a strong reference or DID object: the SDK reads the record and pins its current CID.
- The award pins the definition by the CID it read. The signed-in account must be in **that version's** `allowedIssuers` (omitted: anyone, `[]`: no one), otherwise `Error` and nothing is written or uploaded.
- `validFrom` defaults to `createdAt` (which defaults to the time of the call). A `validUntil` earlier than `validFrom`, or than `createdAt` when `validFrom` is omitted, throws `TypeError`. Timestamps are stored as given. `validUntil` marks the award expired; it is not revocation.
- Awarding does not accept the badge for the recipient; they use `respondToBadgeAward`.
- The new definition and the award are one `applyWrites` commit: both exist afterwards, or neither does.
- `WriteOutcomeUnknownError.attempted` lists the new definition (if any) first, then the award. Do not call again blindly: it would create a second award. Check the URIs with `com.atproto.repo.getRecord` first.
- Nothing is deduplicated: awarding the same badge to the same subject twice creates two awards.

## respondToBadgeAward

`respondToBadgeAward(context, { awardUri, response, weight?, createdAt? })` creates a response in **your** repo and returns `{ uri, cid }`. You must be the award's recipient.

```ts
import { respondToBadgeAward } from "@hypercerts-org/sdk/badge";

await respondToBadgeAward(context, {
  awardUri: "at://did:plc:issuer/app.certified.badge.award/3k2a4b5c6d7e8",
  response: "accepted",
  weight: "2",
});
// `awardUri` is the URI of the award, from the issuer or your app.
await respondToBadgeAward(context, { awardUri, response: "rejected" }); // no weight here
```

- The recipient of an award to an account is that account. For an award to a record it is the account whose repository holds the record (the SDK's rule; the lexicon does not say). Any other signed-in account, the issuer included, gets an `Error` and nothing is written.
- `weight` only goes with `"accepted"`; with `"rejected"` it throws `TypeError`. It must be a positive decimal number written as a string and is stored exactly as written (`"007.50"` stays `"007.50"`).
- Nothing is deduplicated or overwritten: every call creates a response under a new key. Responding twice leaves two responses. Do not repeat after `WriteOutcomeUnknownError` without checking `attempted`.

## Uploads are outside the commit

A new definition's `icon` is uploaded before the write. Invalid input, a refused issuer and an unreadable subject or definition fail before any upload; a rule of the award's or the new definition's lexicon (for example a `note` over 500 characters) is only found after it. If the write or such a rule fails, the blob stays unreferenced (a PDS usually deletes it later, not guaranteed).

## Input fields

`BadgeDefinitionInput` (also `definition` of `awardBadge` when new):

| Field            | Type                 | Notes                                                                  |
| ---------------- | -------------------- | ---------------------------------------------------------------------- |
| `title`          | `string`             | Required. At most 256 characters.                                      |
| `badgeType`      | `string`             | Required. At most 100 characters. Any value is accepted.               |
| `description`    | `string`             | At most 500 graphemes.                                                 |
| `icon`           | `Blob` / `File`      | PNG, JPEG, WebP or SVG, at most 1 MiB. Uploaded by the SDK.            |
| `allowedIssuers` | `string[]` (DIDs)    | At most 100. Omitted: anyone. `[]`: no one.                            |
| `createdAt`      | ISO 8601 `string`    | Defaults to the time of the call.                                      |

`AwardBadgeInput`: `definition` (`BadgeDefinitionInput` or `{ uri }`), `subject` (`{ did }` or `{ uri }`), `note` (at most 500 characters), `url`, `validFrom`, `validUntil`, `createdAt`.

`RespondToBadgeAwardInput`: `awardUri`, `response` (`"accepted"` or `"rejected"`), `weight` (accepted only, at most 50 characters), `createdAt`.

## Pitfalls

- `definition: { uri, title }` (a mix of an existing URI and new fields) throws `TypeError`. Pass one or the other.
- A definition `{ uri }` must be an `app.certified.badge.definition`; another type of record throws `TypeError`.
- An empty `allowedIssuers` is not "no restriction": it makes the badge impossible to award.
