import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, type ReceivedCreate, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  type CollectionInput,
  type CollectionItemInput,
  createCollection,
  type LeafletDocument,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const ACTIVITY = "org.hypercerts.claim.activity";
const COLLECTION = "org.hypercerts.collection";
const FEATURE = "org.hypercerts.entity.feature";
const LOCATION = "app.certified.location";
const RIGHTS = "org.hypercerts.claim.rights";
const VOCAB = "org.hypercerts.vocab.tag";
const WORKSCOPE = "org.hypercerts.workscope.tag";
const LEAFLET = "pub.leaflet.pages.linearDocument";
// CIDv1 (raw, sha-256) of the words "activity", "feature" and "collection": the CIDs the PDS reports
// for the existing records, so a reference that carries the wrong one is noticed.
const ACTIVITY_CID = "bafkreiagkgddx5ozaitcwf6emipmgqcuj7ybm5jfipmzvewx2iuhfwfeku";
const FEATURE_CID = "bafkreibk2vrddf3hcvyipxna33ddsh2eph4kasdjvmgmru5jynrx3lttwu";
const COLLECTION_CID = "bafkreih2oslojlueamdn6qn5mweaaojoetnyvrdwofm5nppyui5srrcoua";

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const activity = { title: "Trees", shortDescription: "Planting trees" };
const tag = (category: string, key: string) => ({ category, key, name: key, status: "accepted" });
const location = (name: string) => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "90.17,27.47" },
  name,
});

describe("createCollection with existing records only", () => {
  const activityUri = uriOf(ACTIVITY, "3jzfcijpj2z2a");
  const featureUri = uriOf(FEATURE, "3jzfcijpj2z2b");
  const collectionUri = uriOf(COLLECTION, "3jzfcijpj2z2c");
  const existing = {
    [activityUri]: ACTIVITY_CID,
    [featureUri]: FEATURE_CID,
    [collectionUri]: COLLECTION_CID,
  };

  it("references each record by the CID it was read with, keeping order, weights and repeats", async () => {
    const { context, requests, creates } = fakeRepo({ existing });

    const result = await createCollection(context, {
      title: "Portfolio",
      items: [
        { uri: featureUri, weight: "0.50" },
        { uri: activityUri, weight: "2" },
        { uri: collectionUri },
        { uri: activityUri, weight: "007" },
      ],
    });

    // Each record is read once, nothing is uploaded, and the Collection is the only write.
    expect(methods(requests)).toEqual([
      ...Array(3).fill("com.atproto.repo.getRecord"),
      "com.atproto.repo.applyWrites",
    ]);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toHaveLength(1);
    const collection = writeOf(creates[0] ?? [], COLLECTION);
    expect(collection.value.items).toEqual([
      { itemIdentifier: { uri: featureUri, cid: FEATURE_CID }, itemWeight: "0.50" },
      { itemIdentifier: { uri: activityUri, cid: ACTIVITY_CID }, itemWeight: "2" },
      { itemIdentifier: { uri: collectionUri, cid: COLLECTION_CID } },
      { itemIdentifier: { uri: activityUri, cid: ACTIVITY_CID }, itemWeight: "007" },
    ]);
    expect(result).toEqual({
      ...refTo(collection),
      tags: [],
      items: [
        { uri: featureUri, cid: FEATURE_CID, type: "feature", created: false },
        { uri: activityUri, cid: ACTIVITY_CID, type: "activity", created: false },
        { uri: collectionUri, cid: COLLECTION_CID, type: "collection", created: false },
        { uri: activityUri, cid: ACTIVITY_CID, type: "activity", created: false },
      ],
    });
  });

  it("creates a bare Collection and keeps an empty items array", async () => {
    const { context, creates } = fakeRepo();

    const bare = await createCollection(context, { title: "Empty" });
    await createCollection(context, { title: "Empty", items: [], tags: [] });

    const first = writeOf(creates[0] ?? [], COLLECTION);
    expect(first.value).toMatchObject({ $type: COLLECTION, title: "Empty" });
    expect(first.value.items).toBeUndefined();
    expect(writeOf(creates[1] ?? [], COLLECTION).value).toMatchObject({ items: [], tags: [] });
    expect(bare).toEqual({ ...refTo(first), tags: [], items: [] });
  });
});

describe("createCollection with new records", () => {
  const existingTag = uriOf(VOCAB, "theme.water");
  const existingCollection = uriOf(COLLECTION, "3jzfcijpj2z2c");

  it("creates every new record in one write, with references to the exact records created", async () => {
    const { context, requests, creates } = fakeRepo({
      existing: { [existingTag]: CID, [existingCollection]: COLLECTION_CID },
    });

    const result = await createCollection(context, {
      title: "Portfolio",
      type: "portfolio",
      location: location("root"),
      tags: [tag("theme", "forest"), { uri: existingTag }],
      items: [
        { activity: { ...activity, locations: [location("site")] }, weight: "3" },
        { feature: { title: "Zone", tags: [{ uri: existingTag }] } },
        {
          collection: {
            title: "Child",
            items: [{ activity }, { uri: existingCollection, weight: "1.50" }],
          },
        },
      ],
    });

    // The existing records and the new tag's key are read first; nothing is uploaded.
    const sent = methods(requests);
    expect(sent.at(-1)).toBe("com.atproto.repo.applyWrites");
    expect(sent.filter((method) => method !== "com.atproto.repo.getRecord")).toHaveLength(1);
    // One request holds everything: records before the ones that point at them, the Collection last.
    expect(creates).toHaveLength(1);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.collection)).toEqual([
      LOCATION,
      VOCAB,
      LOCATION,
      ACTIVITY,
      FEATURE,
      ACTIVITY,
      COLLECTION,
      COLLECTION,
    ]);
    const at = (index: number): ReceivedCreate => {
      const write = writes[index];
      if (write === undefined) throw new Error(`no write at ${index}`);
      return write;
    };
    const [rootLocation, forest, siteLocation, tree, zone, childTree, child, root] = [
      0, 1, 2, 3, 4, 5, 6, 7,
    ].map(at) as [
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
      ReceivedCreate,
    ];
    expect(forest.rkey).toBe("theme.forest");

    expect(root.value).toMatchObject({
      $type: COLLECTION,
      type: "portfolio",
      location: refTo(rootLocation),
      tags: [refTo(forest), { uri: existingTag, cid: CID }],
      items: [
        { itemIdentifier: refTo(tree), itemWeight: "3" },
        { itemIdentifier: refTo(zone) },
        { itemIdentifier: refTo(child) },
      ],
    });
    expect(tree.value.locations).toEqual([refTo(siteLocation)]);
    expect(zone.value.tags).toEqual([{ uri: existingTag, cid: CID }]);
    expect(child.value.items).toEqual([
      { itemIdentifier: refTo(childTree) },
      { itemIdentifier: { uri: existingCollection, cid: COLLECTION_CID }, itemWeight: "1.50" },
    ]);

    expect(result).toEqual({
      ...refTo(root),
      location: { ...refTo(rootLocation), created: true },
      tags: [
        { ...refTo(forest), created: true },
        { uri: existingTag, cid: CID, created: false },
      ],
      items: [
        {
          ...refTo(tree),
          type: "activity",
          created: true,
          locations: [{ ...refTo(siteLocation), created: true }],
          contributors: [],
        },
        {
          ...refTo(zone),
          type: "feature",
          created: true,
          tags: [{ uri: existingTag, cid: CID, created: false }],
          locations: [],
        },
        {
          ...refTo(child),
          type: "collection",
          created: true,
          tags: [],
          items: [
            {
              ...refTo(childTree),
              type: "activity",
              created: true,
              locations: [],
              contributors: [],
            },
            { uri: existingCollection, cid: COLLECTION_CID, type: "collection", created: false },
          ],
        },
      ],
    });
  });

  it("creates the same data twice as two records and does not search for matches", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createCollection(context, {
      title: "Twice",
      items: [{ feature: { title: "Zone" } }, { feature: { title: "Zone" } }],
    });

    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
    const [first, second] = result.items;
    expect(first?.uri).not.toBe(second?.uri);
    expect(creates[0]?.map((write) => write.collection)).toEqual([FEATURE, FEATURE, COLLECTION]);
  });
});

describe("createCollection description and images", () => {
  const document: LeafletDocument = { $type: LEAFLET, blocks: [] };
  const documentUri = uriOf("pub.leaflet.document");

  it.each<[string, CollectionInput["description"], object]>([
    [
      "a string inline",
      "Plain text.",
      { $type: "org.hypercerts.defs#descriptionString", value: "Plain text." },
    ],
    ["a Leaflet document inline, as it is", document, document],
    [
      "{ uri } of a record of any type as a typed strong reference",
      { uri: documentUri },
      { $type: "com.atproto.repo.strongRef", uri: documentUri, cid: CID },
    ],
  ])("stores %s", async (_, description, stored) => {
    const { context, creates } = fakeRepo({ existing: { [documentUri]: CID } });

    await createCollection(context, { title: "Portfolio", description });

    expect(writeOf(creates[0] ?? [], COLLECTION).value.description).toEqual(stored);
  });

  it("keeps a URL avatar as it is and uploads a banner file before the one write", async () => {
    const { context, requests, creates } = fakeRepo();

    await createCollection(context, {
      title: "Portfolio",
      avatar: "https://example.org/avatar.png",
      banner: png(),
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    expect(writeOf(creates[0] ?? [], COLLECTION).value).toMatchObject({
      avatar: { $type: "org.hypercerts.defs#uri", uri: "https://example.org/avatar.png" },
      banner: { $type: "org.hypercerts.defs#largeImage" },
    });
  });

  it("uploads an avatar file as a small image", async () => {
    const { context, creates } = fakeRepo();

    await createCollection(context, { title: "Portfolio", avatar: png() });

    expect(writeOf(creates[0] ?? [], COLLECTION).value.avatar).toMatchObject({
      $type: "org.hypercerts.defs#smallImage",
    });
  });
});

describe("createCollection when the input is wrong", () => {
  const item = (value: unknown) => ({ title: "Portfolio", items: [value as CollectionItemInput] });

  it.each<[string, CollectionInput, RegExp]>([
    [
      "an item with no choice",
      item({ weight: "1" }),
      /input\.items\[0\] must have exactly one of activity, feature, collection or uri, but has none/,
    ],
    [
      "an item with two choices",
      item({ uri: uriOf(ACTIVITY), feature: { title: "Zone" } }),
      /input\.items\[0\] must have exactly one of .* but has feature and uri/,
    ],
    [
      "a bare Activity as an item",
      item(activity),
      /input\.items\[0\].*Allowed fields: activity, feature, collection, uri, weight/,
    ],
    [
      "an item URI that is not an Activity, Feature or Collection",
      item({ uri: uriOf(LOCATION) }),
      /input\.items\[0\]\.uri points at a record of type app\.certified\.location, but this field holds org\.hypercerts\.claim\.activity, org\.hypercerts\.entity\.feature, org\.hypercerts\.collection/,
    ],
    [
      "an item URI with a handle as the authority",
      item({ uri: `at://alice.example.com/${ACTIVITY}/3k2a4b5c6d7e8` }),
      /input\.items\[0\]\.uri must use a DID as the authority, not a handle/,
    ],
    [
      "an item URI without a record key",
      item({ uri: `at://did:plc:abc123/${ACTIVITY}` }),
      /input\.items\[0\]\.uri is not a record URI/,
    ],
    ["an invalid weight", item({ uri: uriOf(ACTIVITY), weight: "0" }), /positive decimal number/],
    [
      "a work-scope tag where a vocabulary tag is needed",
      { title: "Portfolio", tags: [{ uri: uriOf(WORKSCOPE) }] },
      /input\.tags\[0\] points at a record of type org\.hypercerts\.workscope\.tag, but this field holds org\.hypercerts\.vocab\.tag/,
    ],
    [
      "a misspelled field in a child Collection",
      item({ collection: { title: "Child", itms: [] } }),
      /input\.items\[0\]\.collection.*Allowed fields: type, title,/,
    ],
    [
      "a description that is none of the three forms",
      { title: "Portfolio", description: 7 as never },
      /input\.description: must be a string, \{ uri \}/,
    ],
    [
      "the same new tag in two places",
      {
        title: "Portfolio",
        tags: [tag("theme", "forest")],
        items: [{ feature: { title: "Zone", tags: [tag("theme", "forest")] } }],
      },
      /input\.tags\[0\] and input\.items\[0\]\.feature\.tags\[0\] are both new/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createCollection(context, input)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("counts the records nested in every item and sends nothing for more than 200", async () => {
    const { context, requests } = fakeRepo();
    const items = Array.from({ length: 100 }, () => ({
      activity: { ...activity, locations: [location("site")] },
    }));

    // 100 Activities and 100 locations, plus the Collection.
    await expect(createCollection(context, { title: "Big", items })).rejects.toThrow(
      /would write 201 records, but one write holds at most 200/,
    );

    expect(requests).toHaveLength(0);
  });

  it("writes 200 records in one request, the Collection included", async () => {
    const { context, creates } = fakeRepo();
    const items = Array.from({ length: 199 }, (_, i) => ({ feature: { title: `Zone ${i}` } }));

    await createCollection(context, { title: "Big", items });

    expect(creates).toHaveLength(1);
    expect(creates[0]).toHaveLength(200);
  });
});

describe("createCollection reads everything before it uploads anything", () => {
  it("does not upload for an item that fails validation after another that has a file", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createCollection(context, {
        title: "Portfolio",
        avatar: png(),
        items: [
          { activity: { ...activity, image: png() } },
          { activity: { title: "No summary" } as never },
        ],
      }),
    ).rejects.toThrow(/invalid input\.items\[1\]\.activity/);

    expect(requests).toHaveLength(0);
  });

  it("does not upload for an existing record of a later item that cannot be read", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createCollection(context, {
        title: "Portfolio",
        banner: png(),
        items: [
          { activity: { ...activity, image: png() } },
          { activity: { ...activity, rights: { uri: uriOf(RIGHTS) } } },
        ],
      }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("does not upload when a new tag's key is taken", async () => {
    const taken = uriOf(VOCAB, "theme.forest");
    const { context, requests } = fakeRepo({ existing: { [taken]: CID } });

    const error = await createCollection(context, {
      title: "Portfolio",
      avatar: png(),
      tags: [tag("theme", "forest")],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toMatchObject({ uri: taken, attempted: [] });
    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });
});

describe("createCollection when the write fails", () => {
  const input: CollectionInput = {
    title: "Portfolio",
    items: [{ activity }, { feature: { title: "Zone" } }],
  };
  const attempted = (body: Uint8Array | undefined) =>
    (
      JSON.parse(new TextDecoder().decode(body)).writes as { collection: string; rkey: string }[]
    ).map((write) => `at://${DID}/${write.collection}/${write.rkey}`);

  it("reports a definite rejection of the single request, and does not retry", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createCollection(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidRequest" });
    expect(error.message).toMatch(/the 3 records were not created/);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });

  it("reports an unknown outcome with every new record, the Collection last, and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createCollection(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
    const uris = attempted(requests[0]?.body);
    expect(uris).toHaveLength(3);
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual(uris);
    expect(uris.map((uri) => uri.split("/")[3])).toEqual([ACTIVITY, FEATURE, COLLECTION]);
  });
});
