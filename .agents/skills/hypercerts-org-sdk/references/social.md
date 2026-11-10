# Social domain (`@hypercerts-org/sdk/social`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling. Every example assumes `context` from `createSDKContext`.

The subpath covers `app.certified.graph.*` (follows) and `app.certified.feed.*` (likes, reposts). Each action has a create function and an undo function; all of them act on the signed-in account's own repo.

| Create                                | Undo                                    | Record                              | Target                      | Stored `subject`                                    |
| ------------------------------------- | --------------------------------------- | ----------------------------------- | --------------------------- | --------------------------------------------------- |
| `followAccount(context, { targetDid })` | `unfollowAccount(context, { targetDid })` | `app.certified.graph.follow`        | an account's **DID**        | the DID                                             |
| `followEntity(context, { targetUri })`  | `unfollowEntity(context, { targetUri })`  | `app.certified.graph.entityFollow`  | a **record URI**            | the URI only, no CID: survives edits of the record   |
| `like(context, { targetUri })`          | `unlike(context, { targetUri })`          | `app.certified.feed.like`           | a **record URI**            | URI and the CID the SDK read: pins that version      |
| `repost(context, { targetUri })`        | `unrepost(context, { targetUri })`        | `app.certified.feed.repost`         | a **record URI**            | URI and the CID the SDK read: pins that version      |

Create functions return `{ uri, cid }` of the **new social record**, not of the target. Callers never build a strong reference: pass the URI and the SDK reads the CID.

## Targets

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

## Undo and `UndoResult`

Undo functions return `UndoResult`, not `void`:

```ts
import { unlike } from "@hypercerts-org/sdk/social";

const result = await unlike(context, { targetUri: activity });
switch (result.status) {
  case "deleted": // exactly one matching like existed and is gone
    break;
  case "not-found": // no matching like; nothing was deleted
    break;
  case "ambiguous": // result.matchCount likes match; NOTHING was deleted
    // The account liked it more than once. Delete the extras yourself (com.atproto.repo.deleteRecord), then call again.
    break;
}
```

- The SDK lists **all** records of that collection in your own repo (every page, from your PDS, no indexer) and matches by subject: DID for follows, record URI for entity follows, likes and reposts. The CID a like or repost pinned is ignored, so a like of an older version of an edited record is found.
- The target is **not** read, so a deleted or edited target does not stop you removing the like or follow.
- Exactly one match is deleted with a CID guard. If that record changed in between, the PDS refuses: `WriteRejectedError` with `code === "InvalidSwap"`, nothing deleted. The SDK never retries or deletes without the guard; call again to scan afresh.
- A page that fails to load or looks wrong throws `Error`. It is never treated as "not found".
- The scan is a snapshot. It cannot stop another writer creating a matching record meanwhile, so `deleted` does not promise that none remains.
- `WriteOutcomeUnknownError` from an undo: `attempted` is the record the SDK tried to delete. Calling the undo again is safe: it either deletes the record or returns `not-found`.
- The session needs permission to **delete** the collection (`app.certified.graph.follow`, `...graph.entityFollow`, `...feed.like`, `...feed.repost`) to undo, and to create it to create.

## Input fields

| Field        | Used by                                      | Type     | Notes                                                                                   |
| ------------ | -------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `targetDid`  | `followAccount`, `unfollowAccount`           | `DidString` (from `@atproto/lex`) | Required. A DID, not a handle.                                         |
| `targetUri`  | `followEntity`, `like`, `repost` and their undo functions | `string` | Required. Full record URI with a DID authority.                       |
| `createdAt`  | create functions                             | `string` | Optional. ISO 8601 date-time. Default: time of the call.                                |
| `via`        | create functions                             | `string` | Optional. Record URI, read and pinned by the SDK. Any Lexicon.                          |

Unknown fields throw `TypeError`. Undo functions accept only the target.
