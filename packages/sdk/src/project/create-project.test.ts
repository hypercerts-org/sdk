import { describe, expect, it } from "vitest";
import { createCollection } from "../collection/index.js";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import {
  fakeRepo,
  HEAD,
  methods,
  type ReceivedCreate,
  refTo,
  writeOf,
} from "../test-utils/fake-repo.js";
import { location, png, uriOf } from "../test-utils/records.js";
import {
  createProject,
  type LeafletDocument,
  type ProjectInput,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const ACTIVITY = "org.hypercerts.claim.activity";
const COLLECTION = "org.hypercerts.collection";
const FEATURE = "org.hypercerts.entity.feature";
const LOCATION = "app.certified.location";
const VOCAB = "org.hypercerts.vocab.tag";
const LEAFLET = "pub.leaflet.pages.linearDocument";
const DESCRIPTION_STRING = "org.hypercerts.defs#descriptionString";
// CIDv1 (raw, sha-256) of the word "activity": the CID the PDS reports for an existing Activity, so
// a reference that carries another one is noticed.
const ACTIVITY_CID = "bafkreiagkgddx5ozaitcwf6emipmgqcuj7ybm5jfipmzvewx2iuhfwfeku";

const activity = { title: "Trees", shortDescription: "Planting trees" };
const tag = (key: string) => ({ category: "theme", key, name: key, status: "accepted" });

describe("createProject without activities", () => {
  const facets = [
    {
      index: { byteStart: 0, byteEnd: 10 },
      features: [
        { $type: "app.bsky.richtext.facet#link", uri: "https://example.org/valley" } as const,
      ],
    },
  ];
  // A Project with every optional field: the default Activity copies some and must not copy the rest.
  const project: ProjectInput = {
    title: "Phobjikha valley",
    shortDescription: "Restoring the valley",
    shortDescriptionFacets: facets,
    description: "A long text about the valley.",
    langs: ["en"],
    avatar: "https://example.org/valley.png",
    banner: png(),
    location: location("valley"),
    tags: [tag("forest")],
    createdAt: "2024-02-01T00:00:00.000Z",
  };

  it.each<[string, ProjectInput]>([
    ["omitted", project],
    ["empty", { ...project, activities: [] }],
  ])(
    "creates exactly one default Activity that copies the Project's text and banner, and nothing else, when activities is %s",
    async (_, input) => {
      const { context, requests, creates } = fakeRepo();

      const result = await createProject(context, input);

      // The banner file is uploaded once, for the Project's banner and the Activity's image, then
      // everything is written in one request: the Project's location and tag, the one Activity,
      // and the Project last.
      expect(methods(requests).filter((method) => method.endsWith("uploadBlob"))).toHaveLength(1);
      expect(methods(requests).at(-1)).toBe("com.atproto.repo.applyWrites");
      expect(creates).toHaveLength(1);
      const writes = creates[0] ?? [];
      expect(writes.map((write) => write.collection)).toEqual([
        LOCATION,
        VOCAB,
        ACTIVITY,
        COLLECTION,
      ]);
      const created = writeOf(writes, ACTIVITY);
      const stored = writeOf(writes, COLLECTION);
      const banner = stored.value.banner as { image: unknown };
      // No location, tags, avatar, rights, contributors or dates, and the call's timestamp, which is
      // not the Project's.
      expect(created.value).toEqual({
        $type: ACTIVITY,
        title: "Phobjikha valley",
        shortDescription: "Restoring the valley",
        shortDescriptionFacets: facets,
        description: { $type: DESCRIPTION_STRING, value: "A long text about the valley." },
        langs: ["en"],
        image: { $type: "org.hypercerts.defs#smallImage", image: banner.image },
        createdAt: expect.not.stringMatching(/^2024-02-01/),
      });
      expect(stored.value).toMatchObject({
        type: "project",
        description: { value: "A long text about the valley." },
        banner: { $type: "org.hypercerts.defs#largeImage" },
        avatar: { uri: "https://example.org/valley.png" },
      });
      expect(stored.value.items).toEqual([{ itemIdentifier: refTo(created) }]);
      expect(result).toEqual({
        ...refTo(stored),
        location: { ...refTo(writeOf(writes, LOCATION)), created: true },
        tags: [{ ...refTo(writeOf(writes, VOCAB)), created: true }],
        activities: [{ ...refTo(created), created: true, locations: [], contributors: [] }],
      });
    },
  );

  const document: LeafletDocument = { $type: LEAFLET, blocks: [] };
  const documentUri = uriOf("pub.leaflet.document");

  it.each<[string, ProjectInput["description"], object, number]>([
    ["a string", "The valley.", { $type: DESCRIPTION_STRING, value: "The valley." }, 0],
    ["a Leaflet document", document, document, 0],
    [
      "{ uri }, read once, with the CID the Project stores",
      { uri: documentUri },
      { $type: "com.atproto.repo.strongRef", uri: documentUri, cid: CID },
      1,
    ],
  ])("copies a description that is %s verbatim", async (_, description, expected, reads) => {
    const { context, requests, creates } = fakeRepo({ existing: { [documentUri]: CID } });

    await createProject(context, {
      title: "Valley",
      shortDescription: "Restoring the valley",
      description,
    });

    const writes = creates[0] ?? [];
    expect(writeOf(writes, ACTIVITY).value.description).toEqual(expected);
    expect(writeOf(writes, COLLECTION).value.description).toEqual(expected);
    expect(methods(requests).filter((method) => method.endsWith("getRecord"))).toHaveLength(reads);
  });

  const SMALL_IMAGE_MAX = 5 * 1024 * 1024;
  const image = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

  it.each<[string, ProjectInput["banner"], unknown, number]>([
    [
      "a URL as a URL",
      "https://example.org/banner.png",
      { $type: "org.hypercerts.defs#uri", uri: "https://example.org/banner.png" },
      0,
    ],
    [
      "a file of exactly 5 MiB as the Activity's image, from the Project's one upload",
      image(SMALL_IMAGE_MAX),
      expect.objectContaining({ $type: "org.hypercerts.defs#smallImage" }),
      1,
    ],
    // The Project's banner holds up to 10 MiB, the Activity's image 5 MiB: the Activity goes without.
    ["a file over 5 MiB not at all", image(SMALL_IMAGE_MAX + 1), undefined, 1],
  ])("copies the banner as %s", async (_, banner, expected, uploads) => {
    const { context, requests, creates } = fakeRepo();

    await createProject(context, {
      title: "Valley",
      shortDescription: "Restoring the valley",
      banner,
    });

    const writes = creates[0] ?? [];
    expect(writeOf(writes, ACTIVITY).value.image).toEqual(expected);
    // The Project keeps its own banner either way.
    expect(writeOf(writes, COLLECTION).value.banner).toBeDefined();
    expect(methods(requests).filter((method) => method.endsWith("uploadBlob"))).toHaveLength(
      uploads,
    );
  });

  it("stores the one uploaded banner as the Project's banner and the Activity's image: the same blob reference", async () => {
    // The fake hands out another CID for every upload, so a second upload would show as a
    // different CID in the Activity.
    const cids = [CID, HEAD];
    let uploads = 0;
    const { context, creates } = fakeRepo({
      uploadBlob: () =>
        json(200, {
          blob: {
            $type: "blob",
            ref: { $link: cids[uploads++] },
            mimeType: "image/png",
            size: 3,
          },
        }),
    });

    await createProject(context, { title: "Valley", shortDescription: "x", banner: png() });

    const writes = creates[0] ?? [];
    const banner = writeOf(writes, COLLECTION).value.banner as { image: { ref: unknown } };
    expect(uploads).toBe(1);
    expect(writeOf(writes, ACTIVITY).value.image).toEqual({
      $type: "org.hypercerts.defs#smallImage",
      image: banner.image,
    });
    expect(String(banner.image.ref)).toBe(CID);
  });

  it("asks for a shortDescription, naming the field, and sends nothing", async () => {
    const { context, requests } = fakeRepo();

    for (const activities of [undefined, []]) {
      await expect(
        createProject(context, { title: "Phobjikha valley", activities }),
      ).rejects.toThrow(
        /input\.shortDescription is required when `activities` is omitted or empty/,
      );
    }

    expect(requests).toHaveLength(0);
  });

  it.each<[string, ProjectInput, RegExp]>([
    [
      // 70 graphemes of 4 bytes: a title a Project accepts and an Activity does not.
      "a title over the Activity's limit",
      { title: "🌳".repeat(70), shortDescription: "x" },
      /string too big \(maximum 256, got 280\) at \$\.title\. The SDK never shortens them/,
    ],
    [
      "a copied field the Project does not allow, such as more than three langs",
      { title: "Valley", shortDescription: "x", langs: ["en", "fr", "de", "es"] },
      /^createProject: input is not a valid org\.hypercerts\.collection record: .*at \$\.langs\.$/,
    ],
    [
      // The Activity's limit is the same, so this is the Project's own error: no default Activity is
      // blamed, and no advice to pass `activities`, which would not help.
      "a shortDescription over the Project's own limit",
      { title: "Valley", shortDescription: "x".repeat(301) },
      /^createProject: input is not a valid org\.hypercerts\.collection record: grapheme too big \(maximum 300, got 301\) at \$\.shortDescription\.$/,
    ],
  ])("refuses %s instead of shortening it, and sends nothing", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createProject(context, input)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("names a banner file the Project cannot hold as input.banner, not as the Activity's image, and uploads nothing", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createProject(context, {
        title: "Valley",
        shortDescription: "x",
        banner: new Blob(["x"], { type: "text/plain" }),
      }),
    ).rejects.toThrow(/^createProject: input\.banner cannot be stored as a large image/);

    expect(requests).toHaveLength(0);
  });

  it("names a failed banner upload as input.banner, though the default Activity's image is uploaded first", async () => {
    const { context } = fakeRepo({ uploadBlob: () => json(500, { error: "InternalServerError" }) });

    await expect(
      createProject(context, { title: "Valley", shortDescription: "x", banner: png() }),
    ).rejects.toThrow(/^createProject: could not upload input\.banner:/);
  });
});

describe("createProject with activities", () => {
  const existingA = uriOf(ACTIVITY, "3jzfcijpj2z2a");
  const existingB = uriOf(ACTIVITY, "3jzfcijpj2z2b");

  it("lists new and existing Activities in input order with their weights as written, in one write, and creates no default Activity", async () => {
    const { context, requests, creates } = fakeRepo({
      existing: { [existingA]: ACTIVITY_CID, [existingB]: ACTIVITY_CID },
    });

    const result = await createProject(context, {
      title: "Valley",
      activities: [
        { activity, weight: "2" },
        { activity: { uri: existingA }, weight: "0.50" },
        { activity: { ...activity, title: "Wetlands" } },
        { activity: { uri: existingB }, weight: "007" },
      ],
    });

    // Each existing Activity is read once and never rewritten; one request holds every new record.
    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord",
      "com.atproto.repo.getRecord",
      "com.atproto.repo.applyWrites",
    ]);
    expect(creates).toHaveLength(1);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.collection)).toEqual([ACTIVITY, ACTIVITY, COLLECTION]);
    const [trees, wetlands, project] = writes as [ReceivedCreate, ReceivedCreate, ReceivedCreate];
    expect(project.value).toMatchObject({
      type: "project",
      items: [
        { itemIdentifier: refTo(trees), itemWeight: "2" },
        { itemIdentifier: { uri: existingA, cid: ACTIVITY_CID }, itemWeight: "0.50" },
        { itemIdentifier: refTo(wetlands) },
        { itemIdentifier: { uri: existingB, cid: ACTIVITY_CID }, itemWeight: "007" },
      ],
    });
    expect(result.activities).toEqual([
      { ...refTo(trees), created: true, locations: [], contributors: [] },
      { uri: existingA, cid: ACTIVITY_CID, created: false },
      { ...refTo(wetlands), created: true, locations: [], contributors: [] },
      { uri: existingB, cid: ACTIVITY_CID, created: false },
    ]);
  });

  it("lists only existing Activities without writing anything but the Project", async () => {
    const { context, creates } = fakeRepo({ existing: { [existingA]: ACTIVITY_CID } });

    const result = await createProject(context, {
      title: "Valley",
      activities: [{ activity: { uri: existingA } }],
    });

    expect(creates[0]?.map((write) => write.collection)).toEqual([COLLECTION]);
    expect(result.activities).toEqual([{ uri: existingA, cid: ACTIVITY_CID, created: false }]);
  });

  it.each([
    ["a new location and a new tag", location("valley"), [tag("forest")], true],
    [
      "an existing location and tag",
      { uri: uriOf(LOCATION) },
      [{ uri: uriOf(VOCAB, "theme.water") }],
      false,
    ],
  ])("takes %s for the Project's location and tags", async (_, projectLocation, tags, isNew) => {
    const { context, creates } = fakeRepo({
      existing: { [uriOf(LOCATION)]: CID, [uriOf(VOCAB, "theme.water")]: CID },
    });

    const result = await createProject(context, {
      title: "Valley",
      location: projectLocation,
      tags,
      activities: [{ activity }],
    });

    const collections = (creates[0] ?? []).map((write) => write.collection);
    expect(collections.includes(LOCATION)).toBe(isNew);
    expect(collections.includes(VOCAB)).toBe(isNew);
    expect(result.location?.created).toBe(isNew);
    expect(result.tags.map((entry) => entry.created)).toEqual([isNew]);
  });

  it("fails before any upload when the key of a new tag is taken", async () => {
    const taken = uriOf(VOCAB, "theme.forest");
    const { context, requests } = fakeRepo({ existing: { [taken]: CID } });

    const error = await createProject(context, {
      title: "Valley",
      avatar: png(),
      tags: [tag("forest")],
      activities: [{ activity }],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("counts every nested record and sends nothing, not even a read, for more than 200", async () => {
    const { context, requests } = fakeRepo({ existing: { [existingA]: ACTIVITY_CID } });
    const activities = [
      { activity: { uri: existingA } },
      ...Array.from({ length: 100 }, () => ({
        activity: { ...activity, locations: [location("site")] },
      })),
    ];

    // 100 Activities and 100 locations, plus the Project.
    await expect(createProject(context, { title: "Big", activities })).rejects.toThrow(
      /would write 201 records, but one write holds at most 200/,
    );

    expect(requests).toHaveLength(0);
  });
});

describe("createProject when the input is wrong", () => {
  const entry = (value: unknown) => ({ title: "Valley", activities: [value as never] });

  it.each<[string, unknown, RegExp]>([
    [
      "a type",
      { title: "Valley", type: "project" },
      /input\.type is not accepted.*use createCollection/,
    ],
    [
      "items",
      { title: "Valley", items: [] },
      /input\.items is not accepted: a Project lists its Activities in `activities`/,
    ],
    ["a misspelled field", { title: "Valley", activites: [] }, /Allowed fields: title,/],
    [
      "a bare Activity as an entry",
      entry(activity),
      /input\.activities\[0\].*Allowed fields: activity, weight/,
    ],
    [
      "a bare { uri } as an entry",
      entry({ uri: uriOf(ACTIVITY) }),
      /input\.activities\[0\].*Allowed fields: activity, weight/,
    ],
    [
      "a Feature as an entry",
      entry({ feature: { title: "Zone" } }),
      /input\.activities\[0\].*Allowed fields: activity, weight/,
    ],
    ["an entry with no activity", entry({ weight: "1" }), /input\.activities\[0\].*activity/],
    [
      "an Activity that is data and { uri } at once",
      entry({ activity: { ...activity, uri: uriOf(ACTIVITY) } }),
      /input\.activities\[0\]\.activity\.uri combines `uri` with other fields/,
    ],
    [
      "an invalid weight",
      entry({ activity: { uri: uriOf(ACTIVITY) }, weight: "0" }),
      /input\.activities\[0\].*positive decimal number/,
    ],
    [
      "a weight over 100 characters",
      entry({ activity: { uri: uriOf(ACTIVITY) }, weight: "1".repeat(101) }),
      /input\.activities\[0\].*must be at most 100 characters at \$\.weight/,
    ],
    [
      "more than 1000 activities, before any of them is read",
      {
        title: "Valley",
        activities: Array.from({ length: 1001 }, () => ({ activity: { uri: uriOf(ACTIVITY) } })),
      },
      /input.*array too big \(maximum 1000, got 1001\) at \$\.activities/,
    ],
    [
      "a Feature URI",
      entry({ activity: { uri: uriOf(FEATURE) } }),
      /input\.activities\[0\]\.activity\.uri points at a record of type org\.hypercerts\.entity\.feature, but this field holds org\.hypercerts\.claim\.activity/,
    ],
    [
      "a Collection URI",
      entry({ activity: { uri: uriOf(COLLECTION) } }),
      /input\.activities\[0\]\.activity\.uri points at a record of type org\.hypercerts\.collection, but this field holds org\.hypercerts\.claim\.activity/,
    ],
    [
      "an Activity without a summary, named as the caller passed it",
      { title: "Valley", activities: [{ activity }, { activity: { title: "No summary" } }] },
      /invalid input\.activities\[1\]\.activity/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createProject(context, input as ProjectInput)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("names the Activity as the caller passed it when the lexicon rejects it later", async () => {
    const { context } = fakeRepo();

    const error = await createProject(context, {
      title: "Valley",
      activities: [{ activity }, { activity: { ...activity, shortDescription: "x".repeat(301) } }],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(
      /input\.activities\[1\]\.activity is not a valid org\.hypercerts\.claim\.activity record/,
    );
    expect(error.message).not.toMatch(/items/);
  });
});

describe("createProject when the write fails", () => {
  const input: ProjectInput = { title: "Valley", shortDescription: "Restoring the valley" };

  it("reports a definite rejection of the single request, and does not retry", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createProject(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidRequest" });
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });

  it("reports an unknown outcome with every new record, the Project last, and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createProject(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
    const sent = JSON.parse(new TextDecoder().decode(requests[0]?.body)).writes as {
      collection: string;
      rkey: string;
    }[];
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual(
      sent.map((write) => `at://${DID}/${write.collection}/${write.rkey}`),
    );
    expect(sent.map((write) => write.collection)).toEqual([ACTIVITY, COLLECTION]);
  });
});

describe("createCollection of type project", () => {
  it("creates only the Collection: the default Activity belongs to createProject", async () => {
    const { context, creates } = fakeRepo();

    const result = await createCollection(context, { title: "Valley", type: "project" });

    expect(creates).toHaveLength(1);
    expect(creates[0]?.map((write) => write.collection)).toEqual([COLLECTION]);
    expect(result.items).toEqual([]);
  });
});
