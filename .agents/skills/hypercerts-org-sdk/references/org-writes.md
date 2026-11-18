# Writing to an organization (`{ repo: orgDid }`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling. This applies to every write operation in every domain; the operation's own reference describes its input.

An organization's repository is written through the Certified Group Service (CGS). The signed-in account must be a **member** of the group, with the role the operation needs (CGS decides, the SDK does not check it).

## Setup

```ts
import { Client } from "@atproto/lex";
import { createSDKContext } from "@hypercerts-org/sdk";

export const context = createSDKContext({
  client: new Client(session),
  cgs: { url: "https://cgs.example.com", did: "did:web:cgs.example.com" },
});
```

With OAuth the session needs the scope `rpc:app.certified.group.repo.*?aud=<cgs did>` (`aud` is the `cgs.did` you configured, as given). The SDK asks the account's PDS for a service-auth token before every CGS request, so a missing scope fails with a plain `Error` that names the scope.

## Calls

`{ repo }` is the optional last argument. Leave it out, or pass your own DID, and the call is unchanged.

```ts
import { createProject } from "@hypercerts-org/sdk/project";
import { uploadBlob } from "@hypercerts-org/sdk/blob";
import { addActivityToCollection } from "@hypercerts-org/sdk/collection";

// `orgDid` is the organization's DID, never a handle.
await createProject(context, input, { repo: orgDid });
await addActivityToCollection(context, { collection: { uri: orgCollectionUri }, activity }, { repo: orgDid });
const blob = await uploadBlob(context, file, { repo: orgDid }); // inside the options
```

Records get URIs in the organization's repo. A `{ uri }` you reference can be anywhere; one that must be changed (a Collection, a like to undo) must be in the organization's repo.

## What differs from your own repo

- **Not atomic.** One request per record, creates first (supporting records before the records that point at them), updates last. If a write fails after at least one record landed, the call throws `PartialWriteError`; if none landed it throws that write's own error (`WriteRejectedError`, `WriteOutcomeUnknownError`, ...).
- **`swapCommit` is never sent.** `createOrganization` and a new Activity in `addActivityToCollection` / `addActivityToProject` lose that repository-wide guard. The Collection or Project update is still guarded by its own version (`swapRecord`), and `createOrganization` still reports a concurrent creation, because its keys are fixed.
- **Taken keys** (a chosen key such as a vocabulary tag's) are detected by reading the record back from the organization's PDS, so they still throw `RecordAlreadyExistsError`.
- **Undo functions** (`unlike`, ...) take the organization's own record and are safe to repeat: a second delete that CGS refuses to a non-admin counts as done when the record is gone.
- Blobs go to the organization's repo, so its records never point at blobs the repo does not have.
- No API keys (`cgsk_...`): the SDK always acts as the signed-in account.

## `PartialWriteError`

```ts
import { createActivity, PartialWriteError } from "@hypercerts-org/sdk/activity";

try {
  return await createActivity(context, input, { repo: orgDid });
} catch (error) {
  if (error instanceof PartialWriteError) {
    // error.written: what landed, in order. error.failed: the record that failed, with
    // error.failure the error for it. error.notAttempted: never sent.
    // Nothing is rolled back; the written records are valid on their own.
    // To try again, pass `written` entries as { uri } where the input accepts existing records.
  }
  throw error;
}
```

If `failure` is a `WriteOutcomeUnknownError` or `WriteResultMismatchError`, `failed` may exist too: check `failure.attempted` with `com.atproto.repo.getRecord`.

## Pitfalls

- `{ repo }` with an org DID and no `cgs` on the context throws a `TypeError` before any request.
- Passing the org as the second argument (`createProject(context, { repo })`) is treated as input and throws a `TypeError`; `{ repo }` is always last.
- A 20-record call is about 40 requests (a token and a write each), plus blobs. Expect it to be slower than your own repo.
