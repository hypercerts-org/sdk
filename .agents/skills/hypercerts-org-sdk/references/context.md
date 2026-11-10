# Context domain (`@hypercerts-org/sdk/context`)

Read [../SKILL.md](../SKILL.md) first for setup, blob uploads and error handling. Every example assumes `context` from `createSDKContext`.

| Function                | Creates                                  | Returns (`created: true` and a field only when the input had it)  |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `createAttachment`      | `org.hypercerts.context.attachment`      | `{ uri, cid, created, subjects?, location?, tags? }`             |
| `createMeasurement`     | `org.hypercerts.context.measurement`     | `{ uri, cid, created, subjects?, locations? }`                   |
| `createEvaluation`      | `org.hypercerts.context.evaluation`      | `{ uri, cid, created, subject?, measurements?, location? }`      |
| `createAcknowledgement` | `org.hypercerts.context.acknowledgement` | `{ uri, cid, created, subject, context? }`                       |

Each reference in the result is `{ uri, cid, created }`: `created: false` for an existing `{ uri }` record, with the CID it was pinned at.

All four write a TID-keyed record to the signed-in account's repo. The first three also create the new locations, tags and measurements they are given, in the **same** `applyWrites` as the record (all of it exists afterwards, or none); with nothing new to create, the call is a write of one record. For the location and tag fields see [location.md](location.md) and [tag.md](tag.md).

## Linking to records

| Input                                            | Meaning                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `{ uri }` in `subjects`, `subject`                | An existing record of **any** type. Read for its CID, stored as a strong reference, never modified.  |
| `{ uri }` in `location`, `locations`, `tags`, `measurements` | An existing record of that field's type (`app.certified.location`, `org.hypercerts.vocab.tag`, `org.hypercerts.context.measurement`). Another type throws `TypeError`. |
| The fields of a record, in those same four       | A new record, created in the same write. Never mixed with `uri`.                                     |
| A string in `content`, an acknowledgement's `context` | A URL/URI stored as it is, never fetched, no CID.                                                |
| A `Blob`/`File` in `content`                     | Uploaded for you (any type, up to 10 MB; a `Blob` needs a `type`).                                   |

A subject is not limited to an Activity and is not changed: it does not learn about the attachment, measurement or evaluation, and nothing here links an existing record to its subject afterwards. Subject URIs must use a DID, not a handle. A bare string where `{ uri }` is required throws `TypeError`.

## createAttachment

```ts
import { createAttachment } from "@hypercerts-org/sdk/context";

const attachment = await createAttachment(context, {
  title: "Field survey, June 2026",
  contentType: "evidence", // update | report | audit | evidence | testimonial | methodology, others allowed
  subjects: [{ uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" }],
  content: [reportFile, "https://example.org/survey/2026-06"], // uploaded, stored as a URL
  tags: [
    { category: "evidence-kind", key: "survey", name: "Survey", status: "accepted" }, // new
    { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/land-cover.wetland" }, // existing
  ],
  location: { lpVersion: "1.0", srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84", locationType: "coordinate-decimal", location: { string: "90.17,27.47" } },
  capturedAt: "2026-06-12T09:30:00+06:00",
});
attachment.tags?.[0]; // { uri, cid, created: true }
```

- `subjects` is optional: omit it for an attachment recorded before the claim it supports.
- `description` is a string (stored as `descriptionString`). Leaflet documents and `{ uri }` descriptions are not supported.
- A new tag's key is `<category>.<key>`; the SDK reads it first and a taken key throws `RecordAlreadyExistsError` with nothing written. Pass `{ uri }` to reuse a tag.

## createMeasurement

```ts
import { createMeasurement } from "@hypercerts-org/sdk/context";

const measurement = await createMeasurement(context, {
  metric: "Forest area restored",
  unit: "hectares",
  value: "1234.56", // a decimal string, never a number
  subjects: [{ uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" }],
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-06-30T00:00:00.000Z",
  measurers: ["did:plc:abc123"],
  locations: [{ uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }], // or new location data
});
measurement.locations?.[0]; // { uri, cid, created: false }
```

- `value` must be a decimal string: `"1234.56"`, `"-3"`, `"0.10"`. A JavaScript number, `"1,234"` and `"1e3"` throw `TypeError`. The string is stored exactly as written.
- `measurers` (and an evaluation's `evaluators`) are DIDs stored as declared data: no proof the account took part or consents, nobody is notified.
- `endDate` before `startDate` throws. `methodURI` and `evidenceURI` entries are URIs, stored and never fetched.

## createEvaluation

```ts
import { createEvaluation } from "@hypercerts-org/sdk/context";

const evaluation = await createEvaluation(context, {
  evaluators: ["did:plc:abc123"], // required, not defaulted to the signed-in account
  summary: "The restoration meets its stated targets.",
  subject: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
  score: { min: "0", max: "5", value: "4.2" },
  measurements: [
    { metric: "Forest area restored", unit: "hectares", value: "1234.56" }, // new, same fields as createMeasurement
    { uri: "at://did:plc:abc123/org.hypercerts.context.measurement/3k2a4b5c6d7e8" }, // existing
  ],
});
evaluation.measurements; // [{ uri, cid, created: true }, { uri, cid, created: false }]
```

- A new measurement may bring its own new `locations`, created in the same write and reported under `evaluation.measurements[i].locations`. A new measurement's `subjects` are not filled in from the evaluation's `subject`.
- `score` values are decimal strings and are compared exactly: `value` must be from `min` to `max` inclusive, or the call throws.
- `content` and `location` work as in `createAttachment`.

## createAcknowledgement

```ts
import { createAcknowledgement } from "@hypercerts-org/sdk/context";

await createAcknowledgement(context, {
  subject: { uri: "at://did:plc:abc123/org.hypercerts.claim.contributorInformation/3k2a4b5c6d7e8" },
  context: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e9" }, // pinned by CID
  acknowledged: true, // false records a rejection
  comment: "Happy to be listed.",
});
```

- Always written to the **signed-in** account's repo; there is no way to write one for another account. The SDK does not check the account's relationship to the subject.
- `context` is optional: a string is stored as a URI with no CID (lightweight); `{ uri }` is stored as a strong reference pinned to the CID read before the write. Use `{ uri }` when the version matters.
- No `location` or `tags`. Acknowledging the same subject twice creates two records.

## Fields

| Field | Used by | Type | Notes |
| - | - | - | - |
| `title` | attachment | `string` | Required, ≤ 256. |
| `subjects` | attachment, measurement | `{ uri }[]` | ≤ 100, any record type. |
| `contentType` | attachment | `string` | ≤ 64. |
| `content` | attachment, evaluation | `(Blob \| string)[]` | ≤ 100. Files uploaded, strings are URLs. |
| `shortDescription`, `description`, `langs` | attachment | `string`, `string`, `string[]` | `description` is a plain string only. |
| `location` | attachment, evaluation | new location or `{ uri }` | |
| `tags` | attachment | new vocabulary tags or `{ uri }`, ≤ 20 | |
| `capturedAt` | attachment | ISO 8601 with timezone | Not `createdAt`; omit if unknown. |
| `metric`, `unit`, `value` | measurement | `string` | All required; `value` is a decimal string. |
| `startDate`, `endDate` | measurement | ISO 8601 | `endDate` not before `startDate`. |
| `locations` | measurement | new locations or `{ uri }`, ≤ 100 | |
| `methodType`, `methodURI`, `evidenceURI`, `measurers`, `comment` | measurement | `string`, `string`, `string[]`, DID `string[]`, `string` | |
| `evaluators` | evaluation | DID `string[]` | Required, ≤ 1000. |
| `summary` | evaluation | `string` | Required, ≤ 5000. |
| `subject` | evaluation, acknowledgement | `{ uri }` | Required for an acknowledgement. |
| `measurements` | evaluation | new measurements or `{ uri }` | ≤ 100. |
| `score` | evaluation | `{ min, max, value }` decimal strings | |
| `acknowledged` | acknowledgement | `boolean` | Required. |
| `context`, `comment` | acknowledgement | `string \| { uri }`, `string` | |
| `createdAt` | all | ISO 8601 | Defaults to the time of the call. Nested new records get the call's time. |

Not supported: `signatures`, `shortDescriptionFacets`, `commentFacets`, and a non-string attachment `description`.

## Failures

Input errors, unresolved or wrongly typed `{ uri }` records and files the lexicon would reject fail before anything is sent. See [Handle failures](../SKILL.md#6-handle-failures) for the write errors. After `WriteOutcomeUnknownError` the primary record is last in `attempted`, and calling again would create new records under new keys: check the URIs first.

Files (`content`, a new tag's `referenceDocument`, a new location's `{ blob }`) are uploaded before the write and are not rolled back if it fails; see [Uploads are not part of the atomic write](../SKILL.md#uploads-are-not-part-of-the-atomic-write).

## Pitfalls

- `subjects: ["at://..."]` and `subject: "at://..."` throw. Wrap it: `{ uri: "at://..." }`.
- `value: 5` and `score: { value: 3 }` throw. Pass strings.
- A new measurement inside `createEvaluation` is created every call; to attach an existing measurement pass `{ uri }`. A `{ uri }` of an Activity in `measurements` throws.
- An acknowledgement's `context` string is not read or pinned. Pass `{ uri }` to pin the version.
- A `File` with no `type` cannot be uploaded: wrap it, `new Blob([file], { type: "application/pdf" })`.
