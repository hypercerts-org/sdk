# Social domain (`@hypercerts-org/sdk/social`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling. Every example assumes `context` from `createSDKContext`.

The subpath covers `app.certified.graph.*` (follows) and `app.certified.feed.*` (likes, reposts). Each action has a create function and an undo function; all of them act on the signed-in account's own repo. Create functions take the **target** (what to follow, like or repost); undo functions take the **URI of your own record** that the create function made.

| Create                                  | Undo                                      | Record                             | Create target        | Stored `subject`                                   |
| --------------------------------------- | ----------------------------------------- | ---------------------------------- | -------------------- | -------------------------------------------------- |
| `followAccount(context, { targetDid })` | `unfollowAccount(context, { followUri })` | `app.certified.graph.follow`       | an account's **DID** | the DID                                            |
| `followEntity(context, { targetUri })`  | `unfollowEntity(context, { followUri })`  | `app.certified.graph.entityFollow` | a **record URI**     | the URI only, no CID: survives edits of the record |
| `like(context, { targetUri })`          | `unlike(context, { likeUri })`            | `app.certified.feed.like`          | a **record URI**     | URI and the CID the SDK read: pins that version    |
| `repost(context, { targetUri })`        | `unrepost(context, { repostUri })`        | `app.certified.feed.repost`        | a **record URI**     | URI and the CID the SDK read: pins that version    |

Create functions return `{ uri, cid }` of the **new social record**, not of the target. Callers never build a strong reference: pass the URI and the SDK reads the CID.

## Targets of the create functions

- `targetDid` is an account **DID** (`did:plc:...`, `did:web:...`), typed `DidString`. A handle, a record URI or an object fails to compile in TypeScript, and throws `TypeError` at runtime for JavaScript callers or after a cast. Resolve a handle to a DID yourself first.
- A DID held as a plain `string` (a form field, a JSON response) does not compile either. Narrow it with `isDidString(did)` from `@atproto/lex` (`if (!isDidString(did)) throw ...`); do not cast.
- `targetUri` is a **full record URI**: `at://<did>/<collection>/<rkey>`, with a DID as the authority. A bare DID, a handle authority (`at://alice.bsky.social/...`) or a partial URI (no record key) throws `TypeError`. The record may be of any Lexicon.
- To follow an account use `followAccount`, not `followEntity`: `followEntity({ targetUri: "did:plc:..." })` throws.

```ts
import { followAccount, followEntity, like, repost } from "@hypercerts-org/sdk/social";

const activity = "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8";

await followAccount(context, { targetDid: "did:plc:abc123" }); // looks nothing up
await followEntity(context, { targetUri: activity }); // does not read the record, stores no CID
const liked = await like(context, { targetUri: activity }); // reads the record, pins its current CID
await repost(context, { targetUri: activity }); // same
console.log(liked.uri); // at://<your did>/app.certified.feed.like/<tid>
```

A like is social feedback only. It is not an evaluation, an acknowledgement or proof of endorsement; do not present it as one.

## Options

Create functions also take `createdAt` (ISO 8601, default: now) and `via`:

```ts
await like(context, {
  targetUri: activity,
  via: "at://did:plc:def456/app.certified.feed.repost/3k2a4b5c6d7e9", // how you came across it
});
```

`via` is the URI of the record through which the target was found (a repost, a starter pack, ...). The SDK reads it and stores a strong reference; it may be a record of any Lexicon. A `via` that cannot be read fails the call and nothing is written.

## Nothing is deduplicated

Each create call writes a new record under a new TID. Calling `like` twice for the same record creates two likes; the SDK does not look for an existing one and does not toggle. Check your own state first if the app must not create two.

## Undo: delete your own record by its URI

An undo function deletes the one record whose URI you pass and returns `void`. It does not look up the target, scan your repo or ask an indexer.

```ts
import { like, unlike } from "@hypercerts-org/sdk/social";

const liked = await like(context, { targetUri: activity });
// Keep liked.uri (and liked.cid) wherever the app stores the like.

await unlike(context, { likeUri: liked.uri, cid: liked.cid });
```

Where the URI comes from:

- The return value of the create function (`{ uri, cid }` of the new record). Keep it.
- The Hypercerts API or an indexer, which return the record's `uri` and `cid`: `app.certified.feed.getActorReactions` (likes and reposts), `app.certified.graph.getFollow`, `app.certified.graph.getEntityFollow`. The SDK does not call them.

The mistake to avoid is passing the **target's** URI. It throws `TypeError`, because that record is not in the like collection:

```ts
await unlike(context, { likeUri: activity }); // TypeError: the activity is not an app.certified.feed.like record
await unfollowAccount(context, { followUri: "did:plc:abc123" }); // TypeError: not a record URI
```

- `TypeError`, with nothing sent, for: an unknown field; a URI that is not a full record URI with a DID authority; a URI whose collection is not the function's (`app.certified.graph.follow`, `...graph.entityFollow`, `...feed.like`, `...feed.repost`); a URI in another account's repo; a `cid` that is not a CID string.
- `cid` is optional. With it, the PDS deletes the record only if it still has that CID; a record that was replaced throws `WriteRejectedError` with `code === "InvalidSwap"` and stays. Without it, the record is deleted whatever its version.
- A missing record is not an error: the PDS treats deleting it as nothing to do and answers success. A stale URI is harmless, and the call does not say whether it removed anything.
- Each undo deletes only the URI it is given. Duplicates (see above) are separate records: undo each with its own URI.
- `WriteOutcomeUnknownError` from an undo: calling again is safe. `attempted` is the record with the `cid` you passed, and empty when you passed none. For create functions it is not safe to repeat; see [Handle failures](../SKILL.md#6-handle-failures).
- The session needs permission to **delete** the collection to undo, and to create it to create.

## Input fields

| Field       | Used by                             | Type                              | Notes                                                                             |
| ----------- | ----------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `targetDid` | `followAccount`                     | `DidString` (from `@atproto/lex`) | Required. A DID, not a handle.                                                    |
| `targetUri` | `followEntity`, `like`, `repost`    | `string`                          | Required. Full record URI with a DID authority.                                   |
| `createdAt` | create functions                    | `string`                          | Optional. ISO 8601 date-time. Default: time of the call.                          |
| `via`       | create functions                    | `string`                          | Optional. Record URI, read and pinned by the SDK. Any Lexicon.                    |
| `followUri` | `unfollowAccount`, `unfollowEntity` | `string`                          | Required. URI of your own follow (or entity follow) record.                       |
| `likeUri`   | `unlike`                            | `string`                          | Required. URI of your own like record.                                            |
| `repostUri` | `unrepost`                          | `string`                          | Required. URI of your own repost record.                                          |
| `cid`       | undo functions                      | `string`                          | Optional. CID of that record; the delete only happens if the record still has it. |

Unknown fields throw `TypeError`.
