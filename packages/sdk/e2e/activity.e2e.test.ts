import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ActivityInput,
  type CreateActivityResult,
  createActivity,
  createRights,
  type SupportingRecordRef,
} from "../src/activity/index.js";
import { readE2eEnv } from "./env.js";
import { coordinates, PNG, png, rights, unique } from "./fixtures.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  blobIn,
  collections,
  defined,
  expectBlobServed,
  expectReferencesResolve,
  expectStored,
  type Ref,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs, type RewriteRequest } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

const base = () => ({ title: unique("E2E activity"), shortDescription: "Planting native trees" });

// The records of a result in the order the Activity lists them: rights, locations, then each
// contributor's identity and details. Inline values are not records and are left out.
function supportingRefs(result: CreateActivityResult): SupportingRecordRef[] {
  return [
    result.rights,
    ...result.locations,
    ...result.contributors.flatMap(({ identity, details }) => [identity, details]),
  ].filter((entry) => entry !== undefined && "uri" in entry);
}

const refOnly = ({ uri, cid }: Ref): Ref => ({ uri, cid });

describe("createActivity with new records", () => {
  it("stores the Activity and every supporting record, and every reference resolves", async () => {
    const site = new TextEncoder().encode('{"type":"Point","coordinates":[90.17,27.47]}');
    const input: ActivityInput = {
      ...base(),
      description: "Native trees on the valley floor.",
      langs: ["en"],
      image: png(),
      startDate: "2024-03-01T00:00:00Z",
      endDate: "2024-09-01T00:00:00Z",
      rights,
      locations: [
        coordinates,
        {
          ...coordinates,
          locationType: "geojson-point",
          location: { blob: new File([site], "site.geojson", { type: "application/geo+json" }) },
        },
      ],
      contributors: [
        { identity: { displayName: "Alice" }, details: { role: "Lead" }, weight: "2" },
        { identity: { inline: "did:plc:bob456" }, details: { inline: "Volunteer" } },
      ],
    };

    const result = await createActivity(user.context, input);

    const activity = await expectStored(user.client, result);
    expect(activity).toMatchObject({
      title: input.title,
      shortDescription: input.shortDescription,
      description: { value: input.description },
      langs: ["en"],
      startDate: input.startDate,
      endDate: input.endDate,
      image: { $type: "org.hypercerts.defs#smallImage" },
      contributors: [
        { contributionWeight: "2" },
        {
          contributorIdentity: {
            $type: "org.hypercerts.claim.activity#contributorIdentity",
            identity: "did:plc:bob456",
          },
          contributionDetails: {
            $type: "org.hypercerts.claim.activity#contributorRole",
            role: "Volunteer",
          },
        },
      ],
    });
    // Rights, two locations, and the first contributor's identity and details.
    const created = supportingRefs(result);
    expect(created).toHaveLength(5);
    expect(created.every((ref) => ref.created)).toBe(true);
    const referenced = await expectReferencesResolve(user.client, activity);
    expect(referenced.sort(byUri)).toEqual(created.map(refOnly).sort(byUri));
    await expectBlobServed(user.client, user.did, blobIn(activity.image, "image"), PNG);
    const fileLocation = await expectStored(user.client, defined(result.locations[1]));
    await expectBlobServed(user.client, user.did, blobIn(fileLocation.location, "blob"), site);
  });
});

const byUri = (a: Ref, b: Ref) => a.uri.localeCompare(b.uri);

describe("createActivity reusing existing records by URI", () => {
  beforeAll(() => redirectPlcDirectory(readE2eEnv().plcUrl));
  afterAll(() => vi.unstubAllGlobals());

  // Creates rights, a location, contributor information and a contribution in `owner`'s repo.
  async function seedRecordsOf(owner: Account): Promise<SupportingRecordRef[]> {
    const seed = await createActivity(owner.context, {
      ...base(),
      rights,
      locations: [coordinates],
      contributors: [{ identity: { displayName: "Reused" }, details: { role: "Lead" } }],
    });
    const records = supportingRefs(seed);
    expect(records).toHaveLength(4);
    return records;
  }

  // Has the user create an Activity that points at `owner`'s four records instead of making new ones.
  async function reuseRecordsOf(owner: Account): Promise<void> {
    const existing = await seedRecordsOf(owner);
    const [rightsRef, locationRef, identityRef, detailsRef] = existing.map(refOnly);
    const userBefore = await snapshotCounts(user.client);
    const ownerBefore = await snapshotCounts(owner.client);

    const result = await createActivity(user.context, {
      ...base(),
      rights: { uri: defined(rightsRef).uri },
      locations: [{ uri: defined(locationRef).uri }],
      contributors: [
        { identity: { uri: defined(identityRef).uri }, details: { uri: defined(detailsRef).uri } },
      ],
    });

    expect(supportingRefs(result)).toEqual(
      existing.map((ref) => ({ ...refOnly(ref), created: false })),
    );
    const activity = await expectStored(user.client, result);
    const referenced = await expectReferencesResolve(user.client, activity);
    expect(referenced.sort(byUri)).toEqual(existing.map(refOnly).sort(byUri));
    // Only the Activity is new. The reused records were neither copied nor rewritten.
    expect(await snapshotCounts(user.client)).toEqual({
      ...userBefore,
      activity: userBefore.activity + 1,
    });
    if (owner.did !== user.did) expect(await snapshotCounts(owner.client)).toEqual(ownerBefore);
  }

  it("reuses the records of the same account without writing them again", () =>
    reuseRecordsOf(user));

  it("reuses the records of another account without writing them again", async () => {
    const other = await loginAs("user2");
    expect(other.did, "SDK_E2E_USER2 must be a different account than SDK_E2E_USER1").not.toBe(
      user.did,
    );

    await reuseRecordsOf(other);
  });

  it.each([
    [
      "a record that does not exist",
      () => `at://${user.did}/${collections.rights}/3jzfcijpj2z2a`,
      /the record was not found/,
    ],
    [
      "a record of an account the PLC directory does not know",
      () => `at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/${collections.rights}/3jzfcijpj2z2a`,
      /cannot resolve the PDS of did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/,
    ],
  ])("fails for %s and writes nothing", async (_, uri, message) => {
    const before = await snapshotCounts(user.client);

    await expect(
      createActivity(user.context, { ...base(), rights: { uri: uri() } }),
    ).rejects.toThrow(message);

    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("createActivity when the PDS rejects one record of the write", () => {
  // Gives the rights record in an applyWrites request the record key of `taken`, a rights record
  // that already exists, so the PDS must refuse that one create. Counts the requests it changed.
  function collideRightsWith(taken: Ref): RewriteRequest & { rewritten: number } {
    const rkey = defined(taken.uri.split("/").at(-1));
    const rewrite = (path: string, init: RequestInit): RequestInit => {
      if (!path.includes("com.atproto.repo.applyWrites") || typeof init.body !== "string") {
        return init;
      }
      const body = JSON.parse(init.body) as { writes: { collection: string; rkey: string }[] };
      const write = defined(body.writes.find((w) => w.collection === collections.rights));
      write.rkey = rkey;
      rewrite.rewritten += 1;
      return { ...init, body: JSON.stringify(body) };
    };
    rewrite.rewritten = 0;
    return rewrite;
  }

  it("creates none of the records, so the Activity and its other records do not exist", async () => {
    const taken = await createRights(user.context, rights);
    const rewrite = collideRightsWith(taken);
    const tampered = await loginAs("user1", rewrite);
    const before = await snapshotCounts(user.client);

    // The PDS answers a create on an existing record key with HTTP 500, not a 4xx, so the SDK
    // cannot tell the request was refused. That is the case where checking what exists matters.
    await expect(
      createActivity(tampered.context, {
        ...base(),
        rights,
        locations: [coordinates],
        contributors: [{ identity: { displayName: "Alice" }, details: { role: "Lead" } }],
      }),
    ).rejects.toMatchObject({ name: "WriteOutcomeUnknownError" });

    expect(rewrite.rewritten, "the applyWrites request was not changed").toBe(1);
    expect(await snapshotCounts(user.client)).toEqual(before);
    // The existing record was not overwritten either.
    await expectStored(user.client, taken);
  });
});

describe("createActivity when the PDS refuses the request", () => {
  it("reports a WriteRejectedError for an invalid access token and writes nothing", async () => {
    const expired = await loginAs("user1", (_, init) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", "Bearer not-a-valid-token");
      return { ...init, headers };
    });
    const before = await snapshotCounts(user.client);

    await expect(
      createActivity(expired.context, { ...base(), rights, locations: [coordinates] }),
    ).rejects.toMatchObject({ name: "WriteRejectedError" });

    expect(await snapshotCounts(user.client)).toEqual(before);
  });

  it("reports the PDS's error when it refuses an upload, and writes nothing", async () => {
    // Over the PDS's default upload limit of 5 MiB (PDS_BLOB_UPLOAD_LIMIT, which the sandbox does
    // not change) but within the lexicon's limit, so only the PDS can refuse it.
    const tooLarge = new Uint8Array(6 * 1024 * 1024);
    const before = await snapshotCounts(user.client);

    await expect(
      createActivity(user.context, {
        ...base(),
        locations: [
          {
            ...coordinates,
            locationType: "geojson-point",
            location: {
              blob: new File([tooLarge], "site.geojson", { type: "application/geo+json" }),
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /could not upload locations\[0\]\.location: uploadBlob: the upload failed \(PayloadTooLarge/,
    );

    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("createActivity called several times at once", () => {
  it("gives every record its own key, so every call succeeds", async () => {
    const calls = 5;
    const before = await snapshotCounts(user.client);

    const results = await Promise.all(
      Array.from({ length: calls }, () =>
        createActivity(user.context, { ...base(), rights, locations: [coordinates] }),
      ),
    );

    const uris = results.flatMap((result) => [
      result.uri,
      ...supportingRefs(result).map((ref) => ref.uri),
    ]);
    expect(new Set(uris).size).toBe(calls * 3);
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      activity: before.activity + calls,
      rights: before.rights + calls,
      location: before.location + calls,
    });
  });
});

describe("createActivity with invalid input", () => {
  it.each([
    [
      "an endDate before the startDate",
      /endDate before its startDate/,
      {
        startDate: "2024-02-01T00:00:00Z",
        endDate: "2024-01-01T00:00:00Z",
      },
    ],
    ["a field it does not know", /does not know/, { typo: true }],
    [
      "a reused record of the wrong type",
      /points at a record of type app.certified.location/,
      {
        rights: {
          uri: "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.certified.location/3jzfcijpj2z2a",
        },
      },
    ],
  ])("throws a TypeError for %s and writes nothing", async (_, message, mistake) => {
    const before = await snapshotCounts(user.client);

    await expect(
      createActivity(user.context, {
        ...base(),
        rights,
        locations: [coordinates],
        contributors: [{ identity: { displayName: "Alice" }, details: { role: "Lead" } }],
        ...mistake,
      } as ActivityInput),
    ).rejects.toMatchObject({ name: "TypeError", message: expect.stringMatching(message) });

    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});
