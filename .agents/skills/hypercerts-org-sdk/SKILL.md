---
name: hypercerts-org-sdk
description: Write Hypercerts records from an app with @hypercerts-org/sdk. Covers setting up the SDK context from an authenticated @atproto/lex Client, creating an Activity (hypercert claim) together with its rights, locations, contributors and contributions in one atomic write, reusing existing records by URI, creating supporting records, standalone locations and an account profile on their own, uploading images and files as blobs, and handling write failures without creating duplicates. Use when app code imports @hypercerts-org/sdk, or the user wants to create a hypercert, activity claim, contributor, contribution, rights or location record, or an account profile (display name, avatar, banner), on a PDS. Not for changing the SDK's own source.
metadata:
  author: hypercerts-org
  version: "2"
---

# @hypercerts-org/sdk

The SDK turns plain input objects into validated `org.hypercerts.*` / `app.certified.*` records and writes them to the signed-in account's repo. It never logs in, never retries and never deduplicates.

The TSDoc on each export is the full reference. Read it in `node_modules/@hypercerts-org/sdk/dist/**/*.d.ts` before guessing a field. Each domain has its own reference file with examples and field tables (see [Domains](#4-domains)).

## 1. Install

```sh
pnpm add -E @hypercerts-org/sdk @atproto/lex @hypercerts-org/lexicon
```

`@atproto/lex` and `@hypercerts-org/lexicon` are peer dependencies. On pnpm 11+, installing fails with `ERR_PNPM_IGNORED_BUILDS` for `core-js` until you add this to `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  core-js: false
```

## 2. Create the context once

The app does the authentication itself (OAuth, app password, ...). Wrap the resulting session in an `@atproto/lex` `Client`:

```ts
// sdk.ts
import { Client } from "@atproto/lex";
import { createSDKContext } from "@hypercerts-org/sdk";

// `session` comes from the app's own auth code, e.g. an @atproto/oauth-client-node session.
export const context = createSDKContext({ client: new Client(session) });
```

Make a new context when the signed-in account changes. Records are always written to the account behind `client`.

## 3. Import from subpaths

| Import from                    | Exports                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@hypercerts-org/sdk`          | `createSDKContext`, `SDKContext`                                                                                                                                                                       |
| `@hypercerts-org/sdk/activity` | `createActivity`, `createRights`, `createContribution`, `createContributorInformation`, `WriteError`, `WriteRejectedError`, `WriteOutcomeUnknownError`, `WriteResultMismatchError`, input/result types |
| `@hypercerts-org/sdk/actor`    | `createProfile`, `ProfileAlreadyExistsError`, the same `Write*` errors, `ProfileInput`                                                                                                                 |
| `@hypercerts-org/sdk/location` | `createLocation`, the same `Write*` errors, `LocationInput`, `LocationValue`                                                                                                                           |
| `@hypercerts-org/sdk/blob`     | `uploadBlob`                                                                                                                                                                                           |

The root entry does not re-export operations. `import { createActivity } from "@hypercerts-org/sdk"` fails.

## 4. Domains

Operations are grouped by domain, each under its own subpath. Read the domain's reference before writing code for it.

| Domain | Import | Reference |
| - | - | - |
| Activity (hypercert claims, rights, contributors, contributions, locations) | `@hypercerts-org/sdk/activity` | [references/activity.md](references/activity.md) |
| Profile (the account's `app.certified.actor.profile`) | `@hypercerts-org/sdk/actor` | [references/profile.md](references/profile.md) |
| Location (a standalone `app.certified.location`, shared by several activities) | `@hypercerts-org/sdk/location` | [references/location.md](references/location.md) |

Two things to know before opening a reference:

- `createProfile` needs an OAuth scope with both `create` and `update` on `app.certified.actor.profile`. With only `create` it fails with `WriteRejectedError` (403).
- `location: { uri }` inside a location is a link to external data; a whole location given as `{ uri }` in `createActivity` reuses an existing record.

## 5. Images and files

- `create*` operations upload `Blob`/`File` values for you (`image`, `attachment`, a profile's `avatar` and `banner`, a location's `{ blob }`). Pass the file, not an upload result.
- A string is stored as a URL and never fetched.
- Use `uploadBlob` only when writing a record yourself with the client:

```ts
import { readFile } from "node:fs/promises";
import { uploadBlob } from "@hypercerts-org/sdk/blob";

const ref = await uploadBlob(context, await readFile("report.pdf"), {
  mimeType: "application/pdf",
});
// Embed `ref` in a record written soon after; a PDS may delete blobs no record uses.
```

`uploadBlob(context, data, options?)`:

- `data` is a `Blob`, `File`, `Uint8Array` (including Node's `Buffer`) or `ArrayBuffer`. Strings (a path or URL) and streams are rejected; read a stream into a `Blob` or `Uint8Array` first.
- `options.mimeType` is required for bytes. A `Blob`/`File` uses its own `type` when it is omitted.
- It returns the blob ref (`ref`, `mimeType`, `size`) to embed in a record.
- The SDK does not check size or type limits. The PDS checks them on upload, and the record's lexicon checks them on write.

Uploads happen before the write and are not rolled back. If the PDS rejects the write, this call leaves its blobs unreferenced. A PDS usually deletes unreferenced blobs after a while, but that is not guaranteed, and a blob with the same content that another record already uses stays. After `WriteOutcomeUnknownError` or `WriteResultMismatchError` the records may exist, so the blobs may be referenced and publicly readable.

## 6. Handle failures

Order of work: validate input → read `{ uri }` records → upload blobs → validate against lexicons → one write. The SDK never retries.

The three write errors are exported from `@hypercerts-org/sdk/activity`, `/actor` and `/location` and extend `WriteError`. Every `WriteError` has `attempted`: the URI and CID of every record in the request, in request order. `instanceof WriteError` catches all three.

| Error                      | Meaning                                                                                        | What to do                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `TypeError`                | Bad input. The message names the field (e.g. `contributors[1].weight`). Nothing written.       | Fix the input.                                |
| `Error`                    | Not authenticated, a `{ uri }` record could not be read, or an upload failed. Nothing written. | Fix auth or the URI, then retry.              |
| `WriteRejectedError`       | PDS answered 4xx. Nothing created. `status`, `code`.                                           | Safe to fix and retry.                        |
| `WriteOutcomeUnknownError` | Network error, timeout or 5xx. The records may exist. `attempted` lists every URI.             | Check before retrying.                        |
| `WriteResultMismatchError` | Created, but the PDS reported other URIs/CIDs (`reported` vs `attempted`).                     | Do not retry. Log it and inspect the records. |

```ts
import { Client } from "@atproto/lex";
import {
  createActivity,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "@hypercerts-org/sdk/activity";

try {
  return await createActivity(context, input);
} catch (error) {
  if (error instanceof WriteRejectedError) {
    // Nothing exists; safe to correct the input and call again.
    throw new Error(`PDS rejected the activity (${error.code ?? error.status})`, { cause: error });
  }
  if (error instanceof WriteOutcomeUnknownError) {
    // The write is all-or-nothing, so checking the Activity (always last in `attempted`) is enough.
    const activity = error.attempted.at(-1);
    const exists = activity && (await recordExists(context.client, activity.uri));
    if (exists) return { uri: activity.uri, cid: activity.cid }; // it went through
    throw error; // still unknown or not created: let the user retry deliberately
  }
  throw error;
}
```

`recordExists` is your own helper around `com.atproto.repo.getRecord`, which returns `RecordNotFound` when the record is missing.

## Pitfalls

- `createSDKContext({ client: session })` or passing an `@atproto/api` `Agent` throws. Wrap it: `new Client(session)`.
- Passing an `uploadBlob` result as `image` throws. Pass the `Blob`/`File`.
- Retrying blindly after `WriteOutcomeUnknownError` duplicates every record under new keys. The exception is `createProfile`, whose key is fixed and which is only created if absent.
- Do not call operations a subpath does not export, even if a TSDoc example mentions them.

## Verify

1. Imports come only from `@hypercerts-org/sdk`, `.../activity`, `.../actor`, `.../location` or `.../blob`.
2. `tsc --noEmit` passes. The input types catch wrong field names and shapes.
3. `com.atproto.repo.getRecord` on each returned `uri` returns the record, and any references it holds match the URIs and CIDs the SDK returned.
