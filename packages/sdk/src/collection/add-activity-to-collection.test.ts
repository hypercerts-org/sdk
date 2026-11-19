import { type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import {
  type FakeRepoOptions,
  fakeRepo,
  HEAD,
  methods,
  refTo,
  writeOf,
} from "../test-utils/fake-repo.js";
import {
  type AddActivityToCollectionInput,
  addActivityToCollection,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const ACTIVITY = "org.hypercerts.claim.activity";
const COLLECTION = "org.hypercerts.collection";
const FEATURE = "org.hypercerts.entity.feature";
const LOCATION = "app.certified.location";
const RIGHTS = "org.hypercerts.claim.rights";
// CIDv1 (raw, sha-256) of the bytes "other": a head the repo moved to after it was read.
const OTHER_HEAD = "bafkreigzfgfbbunqonmdpxcl3bo2yza3b46o6j5epzovhjkpf47vwl6p7i";
// CIDv1 (raw, sha-256) of the word "activity": the CID the PDS reports for an existing Activity, so
// a reference that carries another one is noticed.
const ACTIVITY_CID = "bafkreiagkgddx5ozaitcwf6emipmgqcuj7ybm5jfipmzvewx2iuhfwfeku";

const collectionUri = `at://${DID}/${COLLECTION}/3k2a4b5c6d7e8`;
const activity = { title: "Trees", shortDescription: "Planting trees" };
const stored = {
  $type: COLLECTION,
  title: "Bhutan portfolio",
  createdAt: "2024-01-01T00:00:00.000Z",
};
// The CID a PDS computes for the stored Collection, which the update's `swapRecord` must carry.
const cidOf = async (record: LexMap) =>
  (await cidForLex(lexParse(JSON.stringify(record)))).toString();
const itemAt = (rkey: string) => ({
  itemIdentifier: { uri: `at://${DID}/${ACTIVITY}/${rkey}`, cid: CID },
});

const call = (input: Partial<AddActivityToCollectionInput> = {}) => ({
  collection: { uri: collectionUri },
  activity,
  ...input,
});

describe("addActivityToCollection with a new Activity", () => {
  it("creates the Activity and adds it to an empty Collection in one request, reading the head first", async () => {
    const { context, requests, creates, updates, swapCommits } = fakeRepo({
      records: { [collectionUri]: stored },
    });

    const result = await addActivityToCollection(context, call());

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord", // the Collection, checked before anything else
      "com.atproto.sync.getLatestCommit",
      "com.atproto.repo.getRecord", // the Collection again, after the head
      "com.atproto.repo.applyWrites",
    ]);
    const created = writeOf(creates[0] ?? [], ACTIVITY);
    expect(creates[0]).toHaveLength(1);
    // The Collection is the only update, and the request is conditional on the head that was read
    // before the Collection.
    expect(updates[0]).toHaveLength(1);
    const update = writeOf(updates[0] ?? [], COLLECTION);
    expect(update.rkey).toBe("3k2a4b5c6d7e8");
    expect(update.value).toEqual({ ...stored, items: [{ itemIdentifier: refTo(created) }] });
    expect(swapCommits).toEqual([HEAD]);
    expect(result).toEqual({
      uri: collectionUri,
      cid: update.cid,
      activity: { ...refTo(created), created: true, locations: [], contributors: [] },
    });
  });

  it("keeps everything else in a populated Collection and appends the item with its weight", async () => {
    const populated: LexMap = {
      ...stored,
      type: "portfolio",
      shortDescription: "Everything we planted",
      langs: ["en"],
      avatar: {
        $type: "org.hypercerts.defs#smallImage",
        image: { $type: "blob", ref: { $link: CID }, mimeType: "image/png", size: 3 },
      },
      items: [
        { ...itemAt("3jzfcijpj2z2a"), itemWeight: "2", note: "kept" },
        itemAt("3jzfcijpj2z2b"),
      ],
      // Signatures are neither checked nor changed.
      signatures: [
        {
          $type: "app.certified.signature.defs#createdVia",
          signature: { $bytes: "AQID" },
          key: "did:web:app.example#key",
        },
      ],
      fieldFromANewerLexicon: { nested: [1, 2, 3] },
    };
    const { context, updates } = fakeRepo({ records: { [collectionUri]: populated } });

    const result = await addActivityToCollection(context, call({ weight: "0.25" }));

    const update = writeOf(updates[0] ?? [], COLLECTION);
    const newItem = {
      itemIdentifier: { uri: result.activity.uri, cid: result.activity.cid },
      itemWeight: "0.25",
    };
    const expected = { ...populated, items: [...(populated.items as unknown[]), newItem] };
    expect(update.value).toEqual(lexParse(JSON.stringify(expected)));
    // The CID the SDK computed for the updated Collection is the one the PDS computed from the wire
    // bytes, including the blob reference and the signature bytes the SDK carried over.
    expect(result.cid).toBe(update.cid);
  });

  it("creates nested records and reuses existing ones as createActivity does, reading the Collection last", async () => {
    const rightsUri = `at://${DID}/${RIGHTS}/3k2a4b5c6d7e8`;
    const { context, requests, creates, updates } = fakeRepo({
      existing: { [rightsUri]: CID },
      records: { [collectionUri]: stored },
    });
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const result = await addActivityToCollection(
      context,
      call({
        activity: {
          ...activity,
          image: png,
          rights: { uri: rightsUri },
          locations: [
            {
              lpVersion: "1.0",
              srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
              locationType: "coordinate-decimal",
              location: { string: "27.47,90.17" },
            },
          ],
        },
      }),
    );

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord", // the Collection, checked before anything else
      "com.atproto.repo.getRecord", // the existing rights
      "com.atproto.repo.uploadBlob",
      "com.atproto.sync.getLatestCommit",
      "com.atproto.repo.getRecord", // the Collection again, after the head
      "com.atproto.repo.applyWrites",
    ]);
    expect((creates[0] ?? []).map((write) => write.collection)).toEqual([LOCATION, ACTIVITY]);
    expect(result.activity).toMatchObject({
      created: true,
      rights: { uri: rightsUri, created: false },
      locations: [{ ...refTo(writeOf(creates[0] ?? [], LOCATION)), created: true }],
    });
    expect(writeOf(updates[0] ?? [], COLLECTION).value.items).toEqual([
      { itemIdentifier: { uri: result.activity.uri, cid: result.activity.cid } },
    ]);
  });
});

describe("addActivityToCollection with an existing Activity", () => {
  const existing = `at://${DID}/${ACTIVITY}/3jzfcijpj2z2a`;

  it("reads it once and lists it at that CID, creating no record but replacing the Collection with a putRecord guarded by the Collection's CID", async () => {
    const { context, requests, creates, updates, puts, swapCommits } = fakeRepo({
      existing: { [existing]: ACTIVITY_CID },
      records: { [collectionUri]: stored },
    });

    const result = await addActivityToCollection(
      context,
      call({ activity: { uri: existing }, weight: "3" }),
    );

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord", // the Collection, checked before anything else
      "com.atproto.repo.getRecord", // the Activity
      "com.atproto.repo.getRecord", // the Collection again, the read whose CID guards the write
      "com.atproto.repo.putRecord", // no head is read and no applyWrites is sent
    ]);
    expect([creates, updates, swapCommits]).toEqual([[], [], []]);
    const [put] = puts;
    expect(put?.collection).toBe(COLLECTION);
    expect(put?.rkey).toBe("3k2a4b5c6d7e8");
    expect(put?.swapRecord).toBe(await cidOf(stored));
    expect(put?.value.items).toEqual([
      { itemIdentifier: { uri: existing, cid: ACTIVITY_CID }, itemWeight: "3" },
    ]);
    expect(result).toEqual({
      uri: collectionUri,
      cid: put?.cid,
      activity: { uri: existing, cid: ACTIVITY_CID, created: false },
    });
  });

  it("is not refused when another record of the account changes meanwhile", async () => {
    let reads = 0;
    const unrelated = fakeRepo({
      existing: { [existing]: ACTIVITY_CID },
      records: { [collectionUri]: stored },
      onRequest: (method, state) => {
        if (method === "com.atproto.repo.getRecord" && ++reads === 3) state.head = OTHER_HEAD;
      },
    });
    await expect(
      addActivityToCollection(unrelated.context, call({ activity: { uri: existing } })),
    ).resolves.toMatchObject({ uri: collectionUri });
  });

  it("is refused when the Collection itself changes between the read and the write", async () => {
    // The Collection is replaced by another writer between the read and the write.
    const options: FakeRepoOptions = {
      existing: { [existing]: ACTIVITY_CID },
      records: { [collectionUri]: stored },
      onRequest: (method) => {
        if (method.endsWith("putRecord")) {
          options.records = { [collectionUri]: { ...stored, title: "Changed meanwhile" } };
        }
      },
    };
    const fake = fakeRepo(options);
    const error = await addActivityToCollection(
      fake.context,
      call({ activity: { uri: existing } }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    expect(error.message).toMatch(
      /the Collection changed since it was read.*Nothing was written.*Call again/,
    );
    expect(error.attempted).toEqual([{ uri: collectionUri, cid: expect.any(String) }]);
    expect(fake.puts).toEqual([]);
  });

  it("lists the same Activity again when it is already an item: nothing is deduplicated", async () => {
    const listed = { itemIdentifier: { uri: existing, cid: ACTIVITY_CID } };
    const { context, puts } = fakeRepo({
      existing: { [existing]: ACTIVITY_CID },
      records: { [collectionUri]: { ...stored, items: [listed] } },
    });

    await addActivityToCollection(context, call({ activity: { uri: existing } }));

    expect(puts[0]?.value.items).toEqual([listed, listed]);
  });

  it("does not write when the Activity cannot be read", async () => {
    const { context, requests } = fakeRepo({ records: { [collectionUri]: stored } });

    await expect(
      addActivityToCollection(context, call({ activity: { uri: existing } })),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
  });
});

describe("addActivityToCollection when the input is wrong", () => {
  it.each<[string, Partial<AddActivityToCollectionInput> | object, RegExp]>([
    [
      "a weight over 100 characters",
      { weight: "1".repeat(101) },
      /invalid input: must be at most 100 characters at \$\.weight/,
    ],
    [
      "`activity` wrapped in another `{ activity }`",
      { activity: { activity } },
      /invalid input\.activity: Missing required key "title"/,
    ],
    [
      "an `activity` that is neither new data nor { uri }",
      { activity: {} },
      /invalid input\.activity: Missing required key "title"/,
    ],
    [
      "an `activity` that is data and { uri } at once",
      { activity: { ...activity, uri: `at://${DID}/${ACTIVITY}/3k2a4b5c6d7e8` } },
      /input\.activity\.uri combines `uri` with other fields/,
    ],
    [
      "a Feature URI",
      { activity: { uri: `at://${DID}/${FEATURE}/3k2a4b5c6d7e8` } },
      /input\.activity\.uri points at a record of type org\.hypercerts\.entity\.feature, but this field holds org\.hypercerts\.claim\.activity/,
    ],
    [
      "a Collection URI",
      { activity: { uri: collectionUri } },
      /input\.activity\.uri points at a record of type org\.hypercerts\.collection, but this field holds org\.hypercerts\.claim\.activity/,
    ],
    [
      "an Activity URI with a handle",
      { activity: { uri: `at://alice.test/${ACTIVITY}/3k2a4b5c6d7e8` } },
      /input\.activity\.uri must use a DID as the authority, not a handle/,
    ],
    [
      "an invalid field of the new Activity, named as the caller wrote it",
      { activity: { ...activity, rights: { inline: "ARR" } } },
      /input\.activity\.rights does not accept \{ inline \}/,
    ],
    [
      "a weight that is not a number",
      { weight: "heavy" },
      /positive decimal number.* at \$\.weight/,
    ],
    [
      "a weight over 100 characters",
      { weight: "1".repeat(101) },
      /must be at most 100 characters at \$\.weight/,
    ],
    [
      "a record of another type",
      { collection: { uri: `at://${DID}/${ACTIVITY}/3k2a4b5c6d7e8` } },
      /collection\.uri points at a record of type org\.hypercerts\.claim\.activity, but it must be of type org\.hypercerts\.collection/,
    ],
    [
      "a Collection of another account",
      { collection: { uri: "at://did:plc:someoneelse/org.hypercerts.collection/3k2a4b5c6d7e8" } },
      /in the repository of did:plc:someoneelse, but the client is signed in as did:plc:testowner123.*own Collections/,
    ],
    [
      "a handle authority",
      { collection: { uri: "at://alice.test/org.hypercerts.collection/3k2a4b5c6d7e8" } },
      /not a record URI/,
    ],
  ])("sends nothing, not even a read, for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo({ records: { [collectionUri]: stored } });
    const image = new Blob(["x"], { type: "image/png" });

    const error = await addActivityToCollection(
      context,
      call({ activity: { ...activity, image }, ...input }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(message);
    expect(requests).toHaveLength(0);
  });
});

describe("addActivityToCollection when the Collection cannot take the item", () => {
  it.each<[string, Parameters<typeof fakeRepo>[0], RegExp, boolean]>([
    ["a Collection that does not exist", {}, /cannot resolve .*the record was not found/, false],
    [
      "a Collection that is not valid",
      { records: { [collectionUri]: { $type: COLLECTION, createdAt: stored.createdAt } } },
      /is not a valid org\.hypercerts\.collection record.*the SDK does not change it/,
      false,
    ],
    [
      "a Collection that holds the most items",
      {
        records: {
          [collectionUri]: {
            ...stored,
            items: Array.from({ length: 1000 }, (_, i) => itemAt(`3jzfcijpj2z${i}`)),
          },
        },
      },
      /already lists 1000 items, the most a Collection can hold \(1000\)/,
      false,
    ],
    [
      "a latest commit that cannot be read",
      {
        records: { [collectionUri]: stored },
        getLatestCommit: () => json(500, { error: "InternalServerError", message: "down" }),
      },
      /cannot read the latest commit of did:plc:testowner123's repository/,
      true,
    ],
  ])("does not write for %s", async (_, options, message, uploaded) => {
    const { context, requests } = fakeRepo(options);
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    await expect(
      addActivityToCollection(context, call({ activity: { ...activity, image } })),
    ).rejects.toThrow(message);

    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
    // A Collection that cannot take the item is found before anything is uploaded.
    expect(methods(requests).includes("com.atproto.repo.uploadBlob")).toBe(uploaded);
  });

  it("adds the 1000th item", async () => {
    const items = Array.from({ length: 999 }, (_, i) => itemAt(`3jzfcijpj${i}`));
    const { context, updates } = fakeRepo({ records: { [collectionUri]: { ...stored, items } } });

    await addActivityToCollection(context, call());

    expect(writeOf(updates[0] ?? [], COLLECTION).value.items).toHaveLength(1000);
  });

  it("counts the Collection update in the write limit and sends nothing past it", async () => {
    const location = {
      lpVersion: "1.0",
      srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      locationType: "geojson-point",
      location: { string: '{"type":"Point","coordinates":[90.13,27.47]}' },
    };
    const withLocations = (count: number) =>
      call({
        activity: { ...activity, locations: Array.from({ length: count }, () => location) },
      });
    const { context, requests, creates, updates } = fakeRepo({
      records: { [collectionUri]: stored },
    });

    await addActivityToCollection(context, withLocations(198));
    expect((creates[0] ?? []).length + (updates[0] ?? []).length).toBe(200);

    const before = requests.length;
    await expect(addActivityToCollection(context, withLocations(199))).rejects.toThrow(
      /would write 201 records, but one write holds at most 200\. Nothing was written/,
    );
    // The Collection is read before the records are counted, and nothing after it.
    expect(methods(requests.slice(before))).toEqual(["com.atproto.repo.getRecord"]);
  });
});

describe("addActivityToCollection when the write fails", () => {
  const withRights = call({
    activity: {
      ...activity,
      rights: {
        rightsName: "CC BY",
        rightsType: "CC-BY",
        rightsDescription: "Share with credit",
      },
    },
  });

  it("rejects the whole request with a clear error when the repository changed after it was read", async () => {
    let collectionReads = 0;
    const { context, requests, creates, updates } = fakeRepo({
      records: { [collectionUri]: stored },
      // Another write to the account lands after the head was read, while the Collection is read
      // the second time.
      onRequest: (method, state) => {
        if (method === "com.atproto.repo.getRecord" && ++collectionReads === 2)
          state.head = OTHER_HEAD;
      },
    });

    const error = await addActivityToCollection(context, withRights).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    expect(error.message).toMatch(
      /the repository changed since it was read.*another write to this account.*Nothing was written.*Call again/,
    );
    expect(error.attempted).toHaveLength(3);
    expect(error.attempted.at(-1).uri).toBe(collectionUri);
    // Nothing was applied and the SDK did not retry.
    expect([creates, updates]).toEqual([[], []]);
    expect(methods(requests).filter((method) => method.endsWith("applyWrites"))).toHaveLength(1);
  });

  it("lists the Collection and every new record when the outcome is unknown", async () => {
    const { context, requests } = fakeRepo({
      records: { [collectionUri]: stored },
      applyWrites: () => json(500, {}),
    });

    const error = await addActivityToCollection(context, withRights).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    const [rights, created, collection] = error.attempted.map((ref: { uri: string }) => ref.uri);
    expect(rights).toMatch(new RegExp(`/${RIGHTS}/`));
    expect(created).toMatch(new RegExp(`/${ACTIVITY}/`));
    expect(collection).toBe(collectionUri);
    for (const uri of [rights, created, collection]) expect(error.message).toContain(uri);
    expect(error.message).toMatch(/was changed/);
    expect(methods(requests).filter((method) => method.endsWith("applyWrites"))).toHaveLength(1);
  });
});
