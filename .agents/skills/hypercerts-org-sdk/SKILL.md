---
name: hypercerts-org-sdk
description: "Write Hypercerts and Certified records (org.hypercerts.*, app.certified.*) to a PDS from an app with @hypercerts-org/sdk: setting up the SDK context from an authenticated @atproto/lex Client, choosing the right operation and subpath, uploading blobs, and handling write errors without duplicates. Use when app code imports @hypercerts-org/sdk, or the user wants to create, link or write hypercert-related records from an app. Not for changing the SDK's own source."
metadata:
  author: hypercerts-org
  version: "7"
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
| `@hypercerts-org/sdk/actor`    | `createProfile`, `ProfileAlreadyExistsError`, `RecordAlreadyExistsError`, the same `Write*` errors, `ProfileInput`                                                                                     |
| `@hypercerts-org/sdk/location` | `createLocation`, the same `Write*` errors, `LocationInput`, `LocationValue`                                                                                                                           |
| `@hypercerts-org/sdk/tag`      | `createVocabularyTag`, `createWorkScopeTag`, `RecordAlreadyExistsError`, the same `Write*` errors, input/result types                                                                                  |
| `@hypercerts-org/sdk/feature`  | `createFeature`, `RecordAlreadyExistsError`, the same `Write*` errors, `FeatureInput`, `CreateFeatureResult`, `LeafletDocument`                                                                        |
| `@hypercerts-org/sdk/organization` | `createOrganization`, `OrganizationAlreadyExistsError`, `RecordAlreadyExistsError`, the same `Write*` errors, `OrganizationInput`, `CreateOrganizationInput`, `CreateOrganizationResult`, `LeafletDocument` |
| `@hypercerts-org/sdk/context`  | `createAttachment`, `createMeasurement`, `createEvaluation`, `createAcknowledgement`, `RecordAlreadyExistsError`, the same `Write*` errors, input/result types |
| `@hypercerts-org/sdk/blob`     | `uploadBlob`                                                                                                                                                                                           |
| `@hypercerts-org/sdk/collection` | `createCollection`, `createActivityInCollection`, `RecordAlreadyExistsError`, `WriteError`, `WriteRejectedError`, `WriteOutcomeUnknownError`, `WriteResultMismatchError`, input/result types                                                         |

The root entry does not re-export operations. `import { createActivity } from "@hypercerts-org/sdk"` fails.

## 4. Domains

Operations are grouped by domain, each under its own subpath. Read the domain's reference before writing code for it.

| Domain | Import | Reference |
| - | - | - |
| Activity (hypercert claims, rights, contributors, contributions, locations, CEL work scopes) | `@hypercerts-org/sdk/activity` | [references/activity.md](references/activity.md) |
| Profile (the account's `app.certified.actor.profile`) | `@hypercerts-org/sdk/actor` | [references/profile.md](references/profile.md) |
| Location (a standalone `app.certified.location`, shared by several activities) | `@hypercerts-org/sdk/location` | [references/location.md](references/location.md) |
| Tag (`org.hypercerts.vocab.tag`, `org.hypercerts.workscope.tag`) | `@hypercerts-org/sdk/tag` | [references/tag.md](references/tag.md) |
| Feature (`org.hypercerts.entity.feature`, with its tags and locations) | `@hypercerts-org/sdk/feature` | [references/feature.md](references/feature.md) |
| Collection (create a Collection with items; add a new Activity to an existing Collection) | `@hypercerts-org/sdk/collection` | [references/collection.md](references/collection.md) |
| Organization (`app.certified.actor.organization`, with its profile and locations) | `@hypercerts-org/sdk/organization` | [references/organization.md](references/organization.md) |
| Context (attachments, measurements, evaluations, acknowledgements) | `@hypercerts-org/sdk/context` | [references/context.md](references/context.md) |

Things to know before opening a reference:

- `createProfile` needs an OAuth scope with both `create` and `update` on `app.certified.actor.profile`. With only `create` it fails with `WriteRejectedError` (403).
- `location: { uri }` inside a location is a link to external data; a whole location given as `{ uri }` in `createActivity` reuses an existing record.
- `createOrganization` takes the name, avatar, banner and website in `profileIfMissing`, not in `organization`, and an existing location as `{ uri }`, never a bare string.
- `createAttachment`, `createMeasurement`, `createEvaluation` and `createAcknowledgement` take a subject as `{ uri }`, never a bare string, and a measured value or score as a decimal string, never a number.

## 5. Images and files

- `create*` operations upload `Blob`/`File` values for you (`image`, a rights record's `attachment`, `content` of `createAttachment` and `createEvaluation`, a profile's `avatar` and `banner`, a location's `{ blob }`). Pass the file, not an upload result.
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

### Uploads are not part of the atomic write

Uploads happen before the write and are not rolled back, so a call that throws can leave blobs that no record references. A PDS usually deletes unreferenced blobs after a while, but that is not guaranteed, and a blob with the same content that another record already uses stays. After `WriteOutcomeUnknownError` or `WriteResultMismatchError` the records may exist, so the blobs may be referenced and publicly readable.

## 6. Handle failures

Order of work: validate input → read `{ uri }` records → upload blobs → validate against lexicons → one write. The SDK never retries.

The three write errors are exported from `@hypercerts-org/sdk/activity`, `/actor`, `/location`, `/tag`, `/feature`, `/collection`, `/context` and `/organization` and extend `WriteError`. Every `WriteError` has `attempted`: the URI and CID of every record in the request, in request order: for `createActivity` the Activity is last; for `createActivityInCollection` the Collection is last and the Activity is just before it; for `createCollection` the Collection is last, after the records it points at; for `createOrganization` the organization is last. `instanceof WriteError` catches all three.

| Error                      | Meaning                                                                                        | What to do                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `TypeError`                | Bad input. The message names the field (e.g. `contributors[1].weight`). Nothing written.       | Fix the input.                                |
| `Error`                    | Not authenticated, a `{ uri }` record could not be read, or an upload failed. Nothing written. | Fix auth or the URI, then retry.              |
| `WriteRejectedError`       | PDS answered 4xx. Nothing created or changed. `status`, `code`.                                | Safe to fix and retry. `InvalidSwap`: see [Concurrent changes](#concurrent-changes-invalidswap). |
| `RecordAlreadyExistsError` | A key you chose is taken (a `WriteRejectedError`). `uri` names the record. Nothing written.    | Use it as `{ uri }`, or choose another key.   |
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
    // The write is all-or-nothing, so checking the Activity (last in `attempted` for `createActivity`) is enough.
    const activity = error.attempted.at(-1);
    const exists = activity && (await recordExists(context.client, activity.uri));
    if (exists) return { uri: activity.uri, cid: activity.cid }; // it went through
    throw error; // still unknown or not created: let the user retry deliberately
  }
  throw error;
}
```

`recordExists` is your own helper around `com.atproto.repo.getRecord`, which returns `RecordNotFound` when the record is missing.

### Concurrent changes (`InvalidSwap`)

`applyWrites` cannot say "only if this record is absent" or "only if it is unchanged". `createOrganization` and `createActivityInCollection` decide something from what they read, so they read the account's latest commit first, then the records, and send the write conditional on that commit. If **anything** wrote to the account in between (even an unrelated record, such as a post), the PDS refuses the whole request: `WriteRejectedError` with `code === "InvalidSwap"`. Nothing was written and nothing is wrong with the input. The SDK never retries or merges. Calling again reads everything afresh, so it is safe.

A taken key has the same `code`, but calling again cannot fix it. `RecordAlreadyExistsError` (and its subclasses `OrganizationAlreadyExistsError` and `ProfileAlreadyExistsError`) is a `WriteRejectedError` too, so rule it out first:

```ts
import {
  createOrganization,
  RecordAlreadyExistsError,
  WriteRejectedError,
} from "@hypercerts-org/sdk/organization";

try {
  return await createOrganization(context, input);
} catch (error) {
  if (
    error instanceof WriteRejectedError &&
    error.code === "InvalidSwap" &&
    !(error instanceof RecordAlreadyExistsError)
  ) {
    return await createOrganization(context, input); // reads everything afresh
  }
  throw error;
}
```

`createActivityInCollection` uses the same check, with `WriteRejectedError` from `@hypercerts-org/sdk/collection`. Calling again does not help when the cause is a taken `key` of a new tag in its `activity`: pass `{ uri }` or choose another key.

## Pitfalls

- `createSDKContext({ client: session })` or passing an `@atproto/api` `Agent` throws. Wrap it: `new Client(session)`.
- Passing an `uploadBlob` result as `image` throws. Pass the `Blob`/`File`.
- Retrying blindly after `WriteOutcomeUnknownError` duplicates every record under new keys. The exception is a call whose records all have a fixed key and are only created if absent: `createProfile` and `createVocabularyTag`. `createOrganization` is also safe to repeat: the organization exists at most once, so a second call creates it or throws `OrganizationAlreadyExistsError`. `createFeature`, `createCollection` and `createWorkScopeTag` are not safe to repeat.
- An item of `createCollection` is `{ activity }`, `{ feature }`, `{ collection }` or `{ uri }`, never a bare Activity input; `{ uri }` must be an Activity, Feature or Collection.
- A vocabulary tag's key is `<category>.<key>` exactly as you pass it. A dot in either part throws a `TypeError`; the SDK does not normalise the parts.
- A work-scope tag URI is not a vocabulary tag URI: each field accepts one collection, and a `{ uri }` of another throws a `TypeError`.
- One write holds at most 200 records on the reference PDS. A larger call throws a `TypeError` before anything is written; the SDK does not split it. Create some records first and pass their URIs.
- Do not call operations a subpath does not export, even if a TSDoc example mentions them.

## Verify

1. Imports come only from `@hypercerts-org/sdk`, `.../activity`, `.../actor`, `.../collection`, `.../context`, `.../feature`, `.../location`, `.../organization`, `.../tag` or `.../blob`.
2. `tsc --noEmit` passes. The input types catch wrong field names and shapes.
3. `com.atproto.repo.getRecord` on each returned `uri` returns the record, and any references it holds match the URIs and CIDs the SDK returned.
