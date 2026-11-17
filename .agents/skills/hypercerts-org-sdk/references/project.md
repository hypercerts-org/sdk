# Project domain (`@hypercerts-org/sdk/project`)

Read [../SKILL.md](../SKILL.md) first for setup and error handling, [activity.md](activity.md) for an `activity` entry, [tag.md](tag.md) / [location.md](location.md) for tags and locations and [collection.md](collection.md) for Collections in general (a Project is a Collection of type `project`). Every example assumes `context` from `createSDKContext`.

Create a project with `createProject`. An Activity on its own may not show up or work in other apps in the ecosystem; apps expect a project (a collection with type `project` that holds its activities). That is why `createProject` exists.

One operation: `createProject` creates a **new** Project with its Activities. To add an Activity to a Project that **already exists**, use `createActivityInCollection` from `@hypercerts-org/sdk/collection`. For Features, child Collections or another `type`, use `createCollection`.

## createProject

`createProject(context, input)` creates an `org.hypercerts.collection` with `type: "project"` (TID key) and every new record in it, in one `applyWrites` commit: the Project, its new Activities (with their rights, locations, contributors, ...), and its location and tags. All of it exists afterwards, or none does.

A Project with no `activities` gets **one default Activity** made from the Project ([what it copies](#the-default-activity)):

```ts
import { createProject } from "@hypercerts-org/sdk/project";

const project = await createProject(context, {
  title: "Phobjikha valley restoration",
  shortDescription: "Restoring the valley's forests and wetlands.", // required without `activities`
  description: "A long text. The default Activity copies it too.",
  banner: "https://example.org/valley.jpg", // becomes the Activity's `image`
});
project.activities[0]; // { uri, cid, created: true, locations: [], contributors: [] }
```

With `activities`, you choose them, and no default Activity is created. Each entry is `{ activity }` (new) or `{ uri }` (existing), with an optional `weight`:

```ts
const project = await createProject(context, {
  title: "Phobjikha valley restoration",
  location: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // reused
  tags: [{ category: "theme", key: "forest", name: "Forest", status: "accepted" }], // created
  activities: [
    { activity: { title: "Reforestation", shortDescription: "Planting 5,000 trees." }, weight: "2" }, // created
    { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8", weight: "0.5" }, // reused
  ],
});
project.activities[0]; // { uri, cid, created: true, locations: [], contributors: [] }
project.activities[1]; // { uri, cid, created: false }
```

- An entry is **exactly one** of `{ activity }` (the data of a new Activity, the same input as `createActivity`) or `{ uri }`, plus an optional `weight`. The SDK never guesses from the fields: a bare Activity (`{ title, shortDescription }`) is a `TypeError`, and so is `{ feature }`.
- `type` and `items` are not accepted (`TypeError`). A Project is always `type: "project"`, and its items are its `activities`.
- `{ uri }` must be an **Activity** with a DID (`at://<did>/org.hypercerts.claim.activity/<rkey>`). A Feature or a Collection URI is a `TypeError` naming the entry, unlike in `createCollection`. It is read for its CID (a strong reference) and reused unchanged; it may belong to another account if public. Another account's PDS is found with the context's `didResolver` ([SKILL.md](../SKILL.md#2-create-the-context-once)).
- `weight` is a positive decimal string (`"2"`, `"0.50"`), stored exactly as you pass it, at most 100 characters. Weights need not add up to anything.
- Order is kept. Nothing is deduplicated or searched for: the same `{ uri }` twice gives two items, the same data twice gives two records.
- `location`, `tags`, `description`, `avatar`, `banner`, `langs`, `shortDescriptionFacets` and `createdAt` work as in `createCollection` ([collection.md](collection.md)). A new tag's key is `<category>.<key>`: a taken key throws `RecordAlreadyExistsError` before anything is uploaded or written.
- The result mirrors the input: `result.activities[i]`, `result.tags[i]` and `result.location` say what was created (`created: true`) or reused (`created: false`). `activities[i].created` is `true` when this call created the Activity, the default one included, and `false` for an existing one passed by `uri`. Narrow an Activity on `created` to reach its nested results (`locations`, `contributors`, ...).
- One write holds at most 200 records, the Project and every nested Activity, location and tag included. A bigger call throws a `TypeError` before anything is read or uploaded; it is never split. Create some records first and pass their `uri`.
- The session needs `create` on every collection the call writes to.

### The default Activity

When `activities` is omitted or empty, the Activity copies these fields of the Project, and **only** these:

- `title`, `shortDescription` and `shortDescriptionFacets`, as they are.
- `description`, as it is: text, a Leaflet document, or `{ uri }` (the record is read once, and the Project and the Activity store the same strong reference).
- `langs`, as they are.
- `banner`, as the Activity's `image`: a URL is stored as a URL. A file is uploaded again for the Activity (once for each record) if it is at most 5 MB. A larger banner is left out of the Activity, with no error: the Project's banner holds up to 10 MB, the Activity's image 5 MB, and the Project keeps its banner.

It does not copy `location`, `tags`, `avatar` or `createdAt` (the Activity's `createdAt` is the time of the call), and it sets no rights, contributors or dates.

An Activity allows less than a Project, and the SDK never shortens a value to fit:

- No `shortDescription` throws a `TypeError` naming `input.shortDescription`.
- A `title` over the Activity's limit (256 bytes, where a Project's holds 800 bytes in at most 80 graphemes: emoji and many scripts use 3 or 4 bytes per character) throws a `TypeError` that says the default Activity cannot hold it. Shorten it, or pass `activities` with an Activity of your own to keep a long title.
- A value over the Project's own limit (a `shortDescription` allows 3000 bytes and 300 graphemes, in the Project and the Activity alike) throws the Project's own `TypeError`, whatever `activities` holds. Passing `activities` does not help: shorten it.
- A banner file the Project's banner cannot be (not a JPEG, PNG or WebP, or over 10 MB) throws a `TypeError` naming `input.banner`, before anything is uploaded.

### Order of work and failures

Validate all input and count the records, read every `{ uri }` and every new tag's key, upload files, build the records, one write. A bad entry, a wrong record type, a value the default Activity cannot hold, too many records or an unreadable `{ uri }` fails (`TypeError` or `Error`) before any upload. A file the image limits reject, or a record the lexicon rejects, is only found when that record is built, so files of other records may already be uploaded. Uploads are not rolled back if the write fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write). Messages name the field as you passed it, for example `input.activities[1].activity.title`.

Errors are as in [Handle failures](../SKILL.md#6-handle-failures). After `WriteOutcomeUnknownError`, `attempted` lists every new record, children before the records that point at them, the Project **last**. The write is all-or-nothing, so check the Project with `getRecord`; if it exists, everything does. **Do not retry blindly**: it would create every record, the default Activity included, again under new keys.

### `ProjectInput`

| Field                    | Type                                   | Notes                                                                                                                           |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `title`                  | `string`                               | Required. At most 800 bytes and 80 graphemes. Copied into the default Activity, which holds at most 256 bytes.                  |
| `shortDescription`       | `string`                               | At most 3000 bytes and 300 graphemes. **Required** when `activities` is omitted or empty: copied into the default Activity.     |
| `activities`             | `ProjectActivityInput[]`               | At most 1000. `{ activity \| uri, weight? }`. Omitted or empty: one default Activity. A non-empty array: no default Activity.   |
| `description`            | `string \| LeafletDocument \| { uri }` | Inline text or document, or a strong reference to a record of any type. Copied into the default Activity as it is.              |
| `langs`                  | `string[]`                             | Up to three BCP-47 tags. Copied into the default Activity.                                                                      |
| `avatar`                 | `string \| Blob`                       | URL stored as is, or an image uploaded (up to 5 MB). Not copied into the default Activity.                                      |
| `banner`                 | `string \| Blob`                       | URL stored as is, or an image uploaded (up to 10 MB). Copied into the default Activity as its `image` (a file only up to 5 MB). |
| `location`               | `LocationInput \| { uri }`             | New or existing `app.certified.location`. Not copied into the default Activity.                                                 |
| `tags`                   | `(VocabularyTagInput \| { uri })[]`    | At most 20; vocabulary tags only. Not copied into the default Activity.                                                         |
| `shortDescriptionFacets` | `app.bsky.richtext.facet[]`            | Rich-text facets of `shortDescription`, passed as given. Copied into the default Activity.                                      |
| `createdAt`              | `string`                               | ISO 8601; defaults to the time of the call, for every new record.                                                               |

Not supported: `type` and `items` (a Project is always `type: "project"`; its items are its `activities`), Features and child Collections in a Project (use `createCollection`), `signatures`, adding Activities to a Project that exists (use `createActivityInCollection`), changing an existing record.
