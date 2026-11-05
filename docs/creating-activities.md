# Creating activities

`createActivity` from `@hypercerts-org/sdk/activity` creates an Activity together with the records it references (rights, locations, contributor information and contributions) in one write. You pass the data; the SDK allocates record keys, computes the references and submits everything at once. The per-field reference is in the TSDoc of each function, shown in your editor.

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";

// `context` comes from createSDKContext; `logo` is a File.
const result = await createActivity(context, {
  title: "Reforestation in the Phobjikha valley",
  shortDescription: "Planting 5,000 native trees.",
  image: logo, // uploaded; a URL string would be stored as it is
  // Placeholder: replace with the URI of an existing rights record, or pass rights fields to create one.
  rights: { uri: "at://did:plc:abc123/org.hypercerts.claim.rights/3k2a4b5c6d7e8" },
  locations: [
    {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "coordinate-decimal",
      location: { string: "27.47,90.17" },
    },
  ],
  contributors: [
    { identity: { displayName: "Alice" }, details: { role: "Lead" }, weight: "2" },
    { identity: { inline: "did:plc:bob456" }, details: { inline: "Volunteer" } },
  ],
});
// result.uri and result.cid identify the Activity. result.rights, result.locations[i] and
// result.contributors[i] mirror the input; each record ref has `created: true` if this call wrote it.
```

## Create, reuse or inline

Each supporting field says what you want. The SDK never guesses and never searches for similar records.

| You pass               | Meaning                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| The fields of a record | Create a new record in your repo.                                                              |
| `{ uri }`              | Reuse an existing record. Its current CID is read; the record is never rewritten.              |
| `{ inline: "..." }`    | Contributors only: store the identity string or role in the Activity itself, without a record. |

`{ uri }` must point at the right type for the field (`org.hypercerts.claim.rights` for `rights`, `app.certified.location` for each location, and so on) and use a DID, not a handle. Do not mix `uri` with record fields.

The standalone `createRights`, `createContributorInformation` and `createContribution` create one such record on their own with the same validation, and return its `{ uri, cid }`.

## Defaults and record keys

- `createdAt` is the time of the call, one timestamp for every record the call creates. Set it on a record to override.
- Each new record gets a new TID as its record key, chosen by the SDK.
- The records are created in the repository of the context's client.

## Atomicity and uploads

All new records are sent in one `com.atproto.repo.applyWrites` request, which a PDS commits as a whole: every record exists afterwards or none does. Blobs are the exception: `Blob` values are uploaded first and are not part of that commit. If the PDS rejects the write (`WriteRejectedError`), this call leaves its uploads unreferenced. A PDS usually deletes unreferenced blobs after a while, but this is not guaranteed, and a blob with the same content that another record already uses stays. After a `WriteOutcomeUnknownError` the records may have been committed, and after a `WriteResultMismatchError` they were, so the blobs can stay referenced and publicly readable; check the attempted records before relying on cleanup. Existing records are read before anything is uploaded, so an unresolvable URI fails without side effects.

## Failures

| Error                      | Means                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TypeError`                | The input is invalid. Nothing was written. The message names the field.                                                                                                                                                                                                        |
| `WriteRejectedError`       | The PDS answered with a 4xx. No record was created. Fix the cause and call again.                                                                                                                                                                                              |
| `WriteOutcomeUnknownError` | No usable answer (network, timeout, 5xx). The records may exist. `attempted` lists every URI. The SDK does not retry.                                                                                                                                                          |
| `WriteResultMismatchError` | The PDS committed the records but reported different URIs or CIDs than the SDK computed, or a different number of results, so references between them may be off. `attempted` holds the computed references and `reported` the PDS's; compare them to inspect what was stored. |

After a `WriteOutcomeUnknownError`, check the URIs (for example with `com.atproto.repo.getRecord`) before trying again. Calling `createActivity` again creates a second set of records under new keys.

```ts
import { createActivity, WriteOutcomeUnknownError } from "@hypercerts-org/sdk/activity";

try {
  await createActivity(context, input);
} catch (error) {
  if (error instanceof WriteOutcomeUnknownError) console.log(error.attempted.map((ref) => ref.uri));
  throw error;
}
```

## Not covered

Collections and projects, updating or deleting records, linking an existing Activity to new records, deduplication and signatures are not part of these functions.
