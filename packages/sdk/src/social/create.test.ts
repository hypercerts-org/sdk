import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { followAccount, followEntity, like, repost, WriteOutcomeUnknownError } from "./index.js";

const ACCOUNT = "did:plc:abc123";
const TARGET = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;
const VIA = `at://${DID}/app.certified.feed.repost/3k2a4b5c6d7e9`;
const TARGET_CID = CID;
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
      followAccount(context, { targetDid: ACCOUNT, ...options }),
    subject: ACCOUNT,
    reads: [],
  },
  {
    name: "followEntity",
    collection: ENTITY_FOLLOW,
    create: (context: Parameters<typeof like>[0], options: object) =>
      followEntity(context, { targetUri: TARGET, ...options }),
    // The URI only: no CID, and the target is not read.
    subject: { $type: "app.certified.defs#recordSubject", uri: TARGET },
    reads: [],
  },
  {
    name: "like",
    collection: LIKE,
    create: (context: Parameters<typeof like>[0], options: object) =>
      like(context, { targetUri: TARGET, ...options }),
    subject: { uri: TARGET, cid: TARGET_CID },
    reads: ["com.atproto.repo.getRecord"],
  },
  {
    name: "repost",
    collection: REPOST,
    create: (context: Parameters<typeof like>[0], options: object) =>
      repost(context, { targetUri: TARGET, ...options }),
    subject: { uri: TARGET, cid: TARGET_CID },
    reads: ["com.atproto.repo.getRecord"],
  },
];

// The target and the `via` record exist in the account's repo, except for `followEntity`'s target,
// which must not be needed.
const existing = { [TARGET]: TARGET_CID, [VIA]: VIA_CID };

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

    await create(context, { via: VIA, createdAt: "2024-01-01T00:00:00.000Z" });

    expect(writeOf(creates[0] ?? [], collection).value).toMatchObject({
      createdAt: "2024-01-01T00:00:00.000Z",
      via: { uri: VIA, cid: VIA_CID },
    });
  });
});

describe("creating", () => {
  it("writes nothing when `via` cannot be read", async () => {
    const { context, requests } = fakeRepo();

    await expect(followAccount(context, { targetDid: ACCOUNT, via: VIA })).rejects.toThrow(
      /cannot resolve .*the record was not found/,
    );

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("does not look for an existing record: calling again creates another", async () => {
    const { context, requests, creates } = fakeRepo({ existing });

    await like(context, { targetUri: TARGET });
    await like(context, { targetUri: TARGET });

    expect(methods(requests)).not.toContain("com.atproto.repo.listRecords");
    expect(creates.map(([write]) => write?.rkey)).toHaveLength(2);
    expect(creates[0]?.[0]?.rkey).not.toEqual(creates[1]?.[0]?.rkey);
  });

  it("rejects a createdAt the lexicon does not accept before writing", async () => {
    const { context, requests } = fakeRepo({ existing });

    await expect(
      followEntity(context, { targetUri: TARGET, createdAt: "yesterday" }),
    ).rejects.toThrow(
      `followEntity: input is not a valid ${ENTITY_FOLLOW} record: Invalid datetime (got "yesterday") at $.createdAt.`,
    );

    expect(requests).toHaveLength(0);
  });

  it("writes nothing when a like's target does not exist", async () => {
    const { context, requests } = fakeRepo();

    await expect(like(context, { targetUri: TARGET })).rejects.toThrow(
      /cannot resolve .*the record was not found/,
    );

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });
});

describe("target validation", () => {
  it.each([
    ["a handle", "alice.bsky.social"],
    ["a record URI", TARGET],
    ["a handle-form URI", "at://alice.bsky.social"],
    ["an object", { did: ACCOUNT }],
    ["nothing", undefined],
  ])("followAccount rejects %s as targetDid", async (_, targetDid) => {
    const { context, requests } = fakeRepo();

    await expect(followAccount(context, { targetDid } as never)).rejects.toThrow(
      /^followAccount: invalid input: must be an account DID.*\$\.targetDid/,
    );

    expect(requests).toHaveLength(0);
  });

  it.each([
    ["followEntity", followEntity],
    ["like", like],
    ["repost", repost],
  ])("%s rejects a target that is not a full record URI", async (name, run) => {
    const { context, requests } = fakeRepo({ existing });
    const invalid = [
      ACCOUNT, // a bare DID
      `at://alice.bsky.social/org.hypercerts.claim.activity/3k2a4b5c6d7e8`, // handle authority
      `at://${DID}/org.hypercerts.claim.activity`, // no record key
      `at://${DID}`,
      "https://example.org/record",
      { uri: TARGET },
    ];

    for (const targetUri of invalid) {
      await expect(run(context, { targetUri } as never)).rejects.toThrow(
        new RegExp(`^${name}: invalid input: must be a full record URI.*\\$\\.targetUri`),
      );
    }

    expect(requests).toHaveLength(0);
  });

  it("rejects a `via` that is not a record URI, and fields the SDK does not know", async () => {
    const { context, requests } = fakeRepo({ existing });

    await expect(like(context, { targetUri: TARGET, via: ACCOUNT })).rejects.toThrow(
      /must be a record URI.*\$\.via/,
    );
    await expect(
      followAccount(context, { targetDid: ACCOUNT, targetUri: TARGET } as never),
    ).rejects.toThrow(/field the SDK does not know/);

    expect(requests).toHaveLength(0);
  });
});

describe("write failures", () => {
  it("reports an unusable answer as WriteOutcomeUnknownError naming the record, without retrying", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(500, { error: "InternalServerError", message: "boom" }),
    });

    const error = await followAccount(context, { targetDid: ACCOUNT }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted).toHaveLength(1);
    expect(error.attempted[0].uri).toMatch(new RegExp(`^at://${DID}/${FOLLOW}/`));
    expect(error.message).toContain(error.attempted[0].uri);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });
});
