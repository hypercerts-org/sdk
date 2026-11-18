import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { followAccount, followEntity, like, repost, WriteOutcomeUnknownError } from "./index.js";

const ACCOUNT = "did:plc:abc123";
const SUBJECT = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;
const VIA = `at://${DID}/app.certified.feed.repost/3k2a4b5c6d7e9`;
const SUBJECT_CID = CID;
// CIDv1 (raw, sha-256) of the bytes "head".
const VIA_CID = "bafkreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju";
const TID = /^[2-7a-z]{13}$/;

const FOLLOW = "app.certified.graph.follow";
const ENTITY_FOLLOW = "app.certified.graph.entityFollow";
const LIKE = "app.certified.feed.like";
const REPOST = "app.certified.feed.repost";

// Each create function with what it must store as `subject`, and the requests it needs for it.
const actions = [
  {
    name: "followAccount",
    collection: FOLLOW,
    create: (context: Parameters<typeof like>[0], options: object) =>
      followAccount(context, { subject: { did: ACCOUNT }, ...options }),
    subject: ACCOUNT,
    reads: [],
  },
  {
    name: "followEntity",
    collection: ENTITY_FOLLOW,
    create: (context: Parameters<typeof like>[0], options: object) =>
      followEntity(context, { subject: { uri: SUBJECT }, ...options }),
    // The URI only: no CID, and the subject is not read.
    subject: { $type: "app.certified.defs#recordSubject", uri: SUBJECT },
    reads: [],
  },
  {
    name: "like",
    collection: LIKE,
    create: (context: Parameters<typeof like>[0], options: object) =>
      like(context, { subject: { uri: SUBJECT }, ...options }),
    subject: { uri: SUBJECT, cid: SUBJECT_CID },
    reads: ["com.atproto.repo.getRecord"],
  },
  {
    name: "repost",
    collection: REPOST,
    create: (context: Parameters<typeof like>[0], options: object) =>
      repost(context, { subject: { uri: SUBJECT }, ...options }),
    subject: { uri: SUBJECT, cid: SUBJECT_CID },
    reads: ["com.atproto.repo.getRecord"],
  },
];

// The subject and the `via` record exist in the account's repo, except for `followEntity`'s subject,
// which must not be needed.
const existing = { [SUBJECT]: SUBJECT_CID, [VIA]: VIA_CID };

describe.each(actions)("$name", ({ collection, create, subject, reads }) => {
  it("writes one record with a TID key and the right subject, and returns its URI and CID", async () => {
    const { context, requests, creates } = fakeRepo({ existing });
    const before = Date.now();

    const ref = await create(context, {});

    expect(methods(requests)).toEqual([...reads, "com.atproto.repo.applyWrites"]);
    const [[write, ...rest] = []] = creates;
    expect(rest).toEqual([]);
    expect(write).toMatchObject({ collection, value: { $type: collection, subject } });
    expect(write?.rkey).toMatch(TID);
    expect(write?.value).not.toHaveProperty("via");
    expect(Date.parse(String(write?.value.createdAt))).toBeGreaterThanOrEqual(before);
    expect(ref).toEqual(write && refTo(write));
  });

  it("pins `via` as a strong reference and keeps `createdAt`", async () => {
    const { context, creates } = fakeRepo({ existing });

    await create(context, { via: { uri: VIA }, createdAt: "2024-01-01T00:00:00.000Z" });

    expect(writeOf(creates[0] ?? [], collection).value).toMatchObject({
      createdAt: "2024-01-01T00:00:00.000Z",
      via: { uri: VIA, cid: VIA_CID },
    });
  });
});

describe("creating", () => {
  it("writes nothing when `via` cannot be read", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      followAccount(context, { subject: { did: ACCOUNT }, via: { uri: VIA } }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("does not look for an existing record: calling again creates another", async () => {
    const { context, requests, creates } = fakeRepo({ existing });

    await like(context, { subject: { uri: SUBJECT } });
    await like(context, { subject: { uri: SUBJECT } });

    expect(methods(requests)).not.toContain("com.atproto.repo.listRecords");
    expect(creates.map(([write]) => write?.rkey)).toHaveLength(2);
    expect(creates[0]?.[0]?.rkey).not.toEqual(creates[1]?.[0]?.rkey);
  });

  it("rejects a createdAt the lexicon does not accept before writing", async () => {
    const { context, requests } = fakeRepo({ existing });

    await expect(
      followEntity(context, { subject: { uri: SUBJECT }, createdAt: "yesterday" }),
    ).rejects.toThrow(
      `followEntity: input is not a valid ${ENTITY_FOLLOW} record: Invalid datetime (got "yesterday") at $.createdAt.`,
    );

    expect(requests).toHaveLength(0);
  });

  it("writes nothing when a like's subject does not exist", async () => {
    const { context, requests } = fakeRepo();

    await expect(like(context, { subject: { uri: SUBJECT } })).rejects.toThrow(
      /cannot resolve .*the record was not found/,
    );

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });
});

describe("read failures name the calling operation", () => {
  it("names the operation when `via` cannot be read", async () => {
    const { context } = fakeRepo();

    await expect(
      followAccount(context, { subject: { did: ACCOUNT }, via: { uri: VIA } }),
    ).rejects.toThrow(/^followAccount: cannot resolve /);
  });

  it("names the operation when a like's subject cannot be read", async () => {
    const { context } = fakeRepo();

    await expect(like(context, { subject: { uri: SUBJECT } })).rejects.toThrow(
      /^like: cannot resolve /,
    );
  });
});

describe("subject validation", () => {
  it.each([
    ["a handle", "alice.bsky.social"],
    ["a record URI", SUBJECT],
    ["a handle-form URI", "at://alice.bsky.social"],
    ["nothing", undefined],
  ])("followAccount rejects %s as subject.did", async (_, did) => {
    const { context, requests } = fakeRepo();

    await expect(followAccount(context, { subject: { did } } as never)).rejects.toThrow(
      /^followAccount: invalid input: must be an account DID.*\$\.subject\.did/,
    );

    expect(requests).toHaveLength(0);
  });

  it("rejects a subject that is a bare string instead of { did } or { uri }", async () => {
    const { context, requests } = fakeRepo({ existing });

    await expect(followAccount(context, { subject: ACCOUNT } as never)).rejects.toThrow(
      /^followAccount: invalid input: .*\$\.subject/,
    );
    await expect(like(context, { subject: SUBJECT } as never)).rejects.toThrow(
      /^like: invalid input: .*\$\.subject/,
    );

    expect(requests).toHaveLength(0);
  });

  it.each([
    ["followEntity", followEntity],
    ["like", like],
    ["repost", repost],
  ])("%s rejects a subject that is not a full record URI", async (name, run) => {
    const { context, requests } = fakeRepo({ existing });
    const invalid = [
      ACCOUNT, // a bare DID
      `at://alice.bsky.social/org.hypercerts.claim.activity/3k2a4b5c6d7e8`, // handle authority
      `at://${DID}/org.hypercerts.claim.activity`, // no record key
      `at://${DID}`,
      "https://example.org/record",
    ];

    for (const uri of invalid) {
      await expect(run(context, { subject: { uri } } as never)).rejects.toThrow(
        new RegExp(`^${name}: invalid input: must be a full record URI.*\\$\\.subject\\.uri`),
      );
    }

    expect(requests).toHaveLength(0);
  });

  it("rejects a `via` that is not a record URI, and fields the SDK does not know", async () => {
    const { context, requests } = fakeRepo({ existing });

    await expect(
      like(context, { subject: { uri: SUBJECT }, via: { uri: ACCOUNT } }),
    ).rejects.toThrow(/must be a full record URI.*\$\.via\.uri/);
    await expect(
      followAccount(context, { subject: { did: ACCOUNT }, subjectUri: SUBJECT } as never),
    ).rejects.toThrow(/field the SDK does not know/);

    expect(requests).toHaveLength(0);
  });
});

describe("write failures", () => {
  it("reports an unusable answer as WriteOutcomeUnknownError naming the record, without retrying", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(500, { error: "InternalServerError", message: "boom" }),
    });

    const error = await followAccount(context, { subject: { did: ACCOUNT } }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted).toHaveLength(1);
    expect(error.attempted[0].uri).toMatch(new RegExp(`^at://${DID}/${FOLLOW}/`));
    expect(error.message).toContain(error.attempted[0].uri);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });
});
