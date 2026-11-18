# Social domain (`@hypercerts-org/sdk/social`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling. Every example assumes `context` from `createSDKContext`.

The subpath covers `app.certified.graph.*` (follows) and `app.certified.feed.*` (likes, reposts). Each action has a create function and an undo function; all of them act on the signed-in account's own repo. Create functions take the **subject** (what to follow, like or repost); undo functions take **your own record** that the create function made, exactly as it returned it.

A record is always `{ uri }` and an account is always `{ did }`, never a bare string.

| Create                                           | Undo                                                 | Record                             | Create subject             | Stored `subject`                                   |
| ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------- | ------------------------- | -------------------------------------------------- |
| `followAccount(context, { subject: { did } })`    | `unfollowAccount(context, { follow })`               | `app.certified.graph.follow`       | an account, `{ did }`     | the DID                                            |
| `followEntity(context, { subject: { uri } })`     | `unfollowEntity(context, { follow })`                | `app.certified.graph.entityFollow` | a record, `{ uri }`       | the URI only, no CID: survives edits of the record |
| `like(context, { subject: { uri } })`             | `unlike(context, { like })`                          | `app.certified.feed.like`          | a record, `{ uri }`       | URI and the CID the SDK read: pins that version    |
| `repost(context, { subject: { uri } })`           | `unrepost(context, { repost })`                      | `app.certified.feed.repost`        | a record, `{ uri }`       | URI and the CID the SDK read: pins that version    |

Create functions return `{ uri, cid }` of the **new social record**, not of the subject. Callers never build a strong reference: pass the URI and the SDK reads the CID.

## Subjects of the create functions

- `subject.did` of `followAccount` is an account **DID** (`did:plc:...`, `did:web:...`). A handle, a record URI or a bare string in place of `{ did }` throws `TypeError`. Resolve a handle to a DID yourself first.
- `subject.uri` is a **full record URI**: `at://<did>/<collection>/<rkey>`, with a DID as the authority. A bare DID, a handle authority (`at://alice.bsky.social/...`) or a partial URI (no record key) throws `TypeError`. The record may be of any Lexicon.
- To follow an account use `followAccount`, not `followEntity`: `followEntity({ subject: { uri: "did:plc:..." } })` throws.

```ts
import { followAccount, followEntity, like, repost } from "@hypercerts-org/sdk/social";

const activity = "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8";

await followAccount(context, { subject: { did: "did:plc:abc123" } }); // looks nothing up
await followEntity(context, { subject: { uri: activity } }); // does not read the record, stores no CID
const liked = await like(context, { subject: { uri: activity } }); // reads the record, pins its current CID
await repost(context, { subject: { uri: activity } }); // same
console.log(liked.uri); // at://<your did>/app.certified.feed.like/<tid>
```

A like is social feedback only. It is not an evaluation, an acknowledgement or proof of endorsement; do not present it as one.

## What the SDK reads and what it does not

The SDK reads a record only to pin its CID in a strong reference. Each subject field is one of two kinds:

- **Strong reference** (URI and CID): the `subject` of `like` and `repost`, and `via`. The SDK reads the record and stores the CID it read. A record it cannot read stops the call, and nothing is written.
- **Plain DID or URI**: the `subject` of `followAccount` and of `followEntity`. The SDK stores it as given and never looks it up, because ATProto lets these dangle. A follow of an account or record that does not exist, or of a mistyped DID or URI, is written. Check the value yourself if that matters.

## Options

Create functions also take `createdAt` (ISO 8601, default: now) and `via`:

```ts
await like(context, {
  subject: { uri: activity },
  via: { uri: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9" }, // how you came across it
});
```

`via` is `{ uri }` of the record through which the subject was found (a repost, a starter pack, ...). The SDK reads it and stores a strong reference; it may be a record of any Lexicon. A `via` that cannot be read fails the call and nothing is written.

## Nothing is deduplicated

Each create call writes a new record under a new TID. Calling `like` twice for the same record creates two likes; the SDK does not look for an existing one and does not toggle. Check your own state first if the app must not create two.

## Undo: delete your own record

An undo function deletes the one record you pass, as `{ uri, cid? }` under the action's field (`like`, `repost` or `follow`), and returns `void`. What the create function returned fits as it is. It does not look up the subject, scan your repo or ask an indexer.

```ts
import { like, unlike } from "@hypercerts-org/sdk/social";

const liked = await like(context, { subject: { uri: activity } });
// Keep `liked` ({ uri, cid }) wherever the app stores the like.

await unlike(context, { like: liked });
```

Where the URI comes from:

- The return value of the create function (`{ uri, cid }` of the new record). Keep it and pass it as `{ like: liked }`.
- The Hypercerts API or an indexer, which return the record's `uri` and `cid`: `app.certified.feed.getActorReactions` (likes and reposts), `app.certified.graph.getFollow`, `app.certified.graph.getEntityFollow`. The SDK does not call them.

The mistake to avoid is passing the **subject's** URI. It throws `TypeError`, because that record is not in the like collection:

```ts
await unlike(context, { like: { uri: activity } }); // TypeError: the activity is not an app.certified.feed.like record
await unfollowAccount(context, { follow: { uri: "did:plc:abc123" } }); // TypeError: not a record URI
```

- `TypeError`, with nothing sent, for: an unknown field; a URI that is not a full record URI with a DID authority; a URI whose collection is not the function's (`app.certified.graph.follow`, `...graph.entityFollow`, `...feed.like`, `...feed.repost`); a URI in another account's repo; a `cid` that is not a CID string.
- `cid` (inside the record object) is optional. With it, the PDS deletes the record only if it still has that CID; a record that was replaced throws `WriteRejectedError` with `code === "InvalidSwap"` and stays. Without it, the record is deleted whatever its version.
- A missing record is not an error: the PDS treats deleting it as nothing to do and answers success. A stale URI is harmless, and the call does not say whether it removed anything.
- Each undo deletes only the URI it is given. Duplicates (see above) are separate records: undo each with its own URI.
- `WriteOutcomeUnknownError` from an undo: calling again is safe. `attempted` is the record with the `cid` you passed, and empty when you passed none. For create functions it is not safe to repeat; see [Handle failures](../SKILL.md#6-handle-failures).
- The session needs permission to **delete** the collection to undo, and to create it to create.

## Input fields

| Field       | Used by                             | Type                         | Notes                                                                                 |
| ----------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `subject`    | `followAccount`                     | `{ did: string }`            | Required. A DID, not a handle. Stored as given, not looked up.                        |
| `subject`    | `followEntity`, `like`, `repost`    | `{ uri: string }`            | Required. Full record URI with a DID authority. See above for what is read.           |
| `createdAt` | create functions                    | `string`                     | Optional. ISO 8601 date-time. Default: time of the call.                              |
| `via`       | create functions                    | `{ uri: string }`            | Optional. Record URI, read and pinned by the SDK. Any Lexicon.                        |
| `follow`    | `unfollowAccount`, `unfollowEntity` | `{ uri: string; cid?: string }` | Required. Your own follow (or entity follow) record, as the create function returned it. |
| `like`      | `unlike`                            | `{ uri: string; cid?: string }` | Required. Your own like record.                                                       |
| `repost`    | `unrepost`                          | `{ uri: string; cid?: string }` | Required. Your own repost record.                                                     |

`cid` (inside `follow`, `like` or `repost`) is optional: the delete only happens if the record still has that CID.

Unknown fields throw `TypeError`.
