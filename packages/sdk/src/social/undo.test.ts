import { describe, expect, it } from "vitest";
import { fakeCollection, type StoredEntry } from "../test-utils/fake-collection.js";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { methods } from "../test-utils/fake-repo.js";
import {
  unfollowAccount,
  unfollowEntity,
  unlike,
  unrepost,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const ACCOUNT = "did:plc:abc123";
const OTHER_ACCOUNT = "did:plc:other456";
const TARGET = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;
const OTHER_TARGET = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e9`;
// CIDv1 (raw, sha-256) of the bytes "head": a version of the target other than CID.
const OLD_CID = "bafkreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju";
const CREATED_AT = "2024-01-01T00:00:00.000Z";

type Context = Parameters<typeof unlike>[0];

// Each undo function, the record it removes, and the same kind of record for another target.
const actions = [
  {
    name: "unfollowAccount",
    collection: "app.certified.graph.follow",
    undo: (context: Context) => unfollowAccount(context, { targetDid: ACCOUNT }),
    record: (subject: string) => subject,
    mine: ACCOUNT,
    others: OTHER_ACCOUNT,
  },
  {
    name: "unfollowEntity",
    collection: "app.certified.graph.entityFollow",
    undo: (context: Context) => unfollowEntity(context, { targetUri: TARGET }),
    record: (subject: string) => ({ $type: "app.certified.defs#recordSubject", uri: subject }),
    mine: TARGET,
    others: OTHER_TARGET,
  },
  {
    name: "unlike",
    collection: "app.certified.feed.like",
    undo: (context: Context) => unlike(context, { targetUri: TARGET }),
    // Pins a version of the target that is not the one it has now.
    record: (subject: string) => ({ uri: subject, cid: OLD_CID }),
    mine: TARGET,
    others: OTHER_TARGET,
  },
  {
    name: "unrepost",
    collection: "app.certified.feed.repost",
    undo: (context: Context) => unrepost(context, { targetUri: TARGET }),
    record: (subject: string) => ({ uri: subject, cid: OLD_CID }),
    mine: TARGET,
    others: OTHER_TARGET,
  },
];

describe.each(actions)("$name", ({ collection, undo, record, mine, others }) => {
  const entry = (rkey: string, subject: string): StoredEntry => ({
    rkey,
    cid: CID,
    value: { $type: collection, subject: record(subject), createdAt: CREATED_AT },
  });

  it("deletes the one matching record, guarded by its CID, without reading the target", async () => {
    // The target now has another CID than the one the record pins; it is not read anyway.
    const { context, requests, deletes, lists } = fakeCollection({
      entries: { [collection]: [entry("3aaaaaaaaaaaa", others), entry("3bbbbbbbbbbbb", mine)] },
      existing: { [TARGET]: CID },
    });

    const result = await undo(context);

    expect(result).toEqual({ status: "deleted" });
    expect(deletes).toEqual([{ repo: DID, collection, rkey: "3bbbbbbbbbbbb", swapRecord: CID }]);
    expect(lists).toEqual([{ repo: DID, collection, cursor: null, limit: "100" }]);
    expect(methods(requests)).toEqual([
      "com.atproto.repo.listRecords",
      "com.atproto.repo.deleteRecord",
    ]);
  });

  it("returns not-found, and deletes nothing, when no record matches", async () => {
    const { context, requests, deletes } = fakeCollection({
      entries: {
        [collection]: [entry("3aaaaaaaaaaaa", others)],
        // The same subject in another collection is not this action's record.
        "app.certified.graph.other": [entry("3bbbbbbbbbbbb", mine)],
      },
    });

    await expect(undo(context)).resolves.toEqual({ status: "not-found" });

    expect(deletes).toEqual([]);
    expect(methods(requests)).toEqual(["com.atproto.repo.listRecords"]);
  });

  it("returns ambiguous with the count, and deletes nothing, when several records match", async () => {
    const { context, deletes } = fakeCollection({
      entries: {
        [collection]: [entry("3aaaaaaaaaaaa", mine), entry("3bbbbbbbbbbbb", mine)],
      },
    });

    await expect(undo(context)).resolves.toEqual({ status: "ambiguous", matchCount: 2 });

    expect(deletes).toEqual([]);
  });
});

describe("unfollowEntity matching", () => {
  const collection = "app.certified.graph.entityFollow";
  const stored = (rkey: string, subject?: unknown): StoredEntry => ({
    rkey,
    cid: CID,
    value: {
      $type: collection,
      createdAt: CREATED_AT,
      ...(subject === undefined ? {} : { subject }),
    },
  });

  it("does not match a subject of another type with the same uri, or a record without a usable subject", async () => {
    const { context, deletes } = fakeCollection({
      entries: {
        [collection]: [
          stored("3aaaaaaaaaaaa", { $type: "app.example.other#subject", uri: TARGET }),
          stored("3bbbbbbbbbbbb", { uri: TARGET }),
          stored("3cccccccccccc"),
          stored("3dddddddddddd", { $type: "app.certified.defs#recordSubject" }),
          stored("3eeeeeeeeeeee", ACCOUNT),
        ],
      },
    });

    await expect(unfollowEntity(context, { targetUri: TARGET })).resolves.toEqual({
      status: "not-found",
    });

    expect(deletes).toEqual([]);
  });
});

describe("scanning the records", () => {
  const collection = "app.certified.feed.like";
  const like = (rkey: string, subject: string): StoredEntry => ({
    rkey,
    cid: CID,
    value: { $type: collection, subject: { uri: subject, cid: OLD_CID }, createdAt: CREATED_AT },
  });
  const unlikeTarget = (context: Context) => unlike(context, { targetUri: TARGET });

  it("reads every page, so a single match on the last page is found", async () => {
    const { context, deletes, lists } = fakeCollection({
      pageSize: 2,
      entries: {
        [collection]: [
          like("3aaaaaaaaaaaa", OTHER_TARGET),
          like("3bbbbbbbbbbbb", OTHER_TARGET),
          like("3cccccccccccc", OTHER_TARGET),
          like("3dddddddddddd", OTHER_TARGET),
          like("3eeeeeeeeeeee", TARGET),
        ],
      },
    });

    await expect(unlikeTarget(context)).resolves.toEqual({ status: "deleted" });

    expect(lists.map((list) => list.cursor)).toEqual([null, "2", "4"]);
    expect(deletes.map(({ rkey }) => rkey)).toEqual(["3eeeeeeeeeeee"]);
  });

  it("counts matches over all pages", async () => {
    const { context, deletes } = fakeCollection({
      pageSize: 2,
      entries: {
        [collection]: [
          like("3aaaaaaaaaaaa", TARGET),
          like("3bbbbbbbbbbbb", OTHER_TARGET),
          like("3cccccccccccc", TARGET),
          like("3dddddddddddd", OTHER_TARGET),
          like("3eeeeeeeeeeee", TARGET),
        ],
      },
    });

    await expect(unlikeTarget(context)).resolves.toEqual({ status: "ambiguous", matchCount: 3 });

    expect(deletes).toEqual([]);
  });

  describe("when the records cannot be read in full", () => {
    // The first page holds the one match: acting on it would be wrong if the rest cannot be read.
    const firstPage = {
      records: [
        {
          uri: `at://${DID}/${collection}/3aaaaaaaaaaaa`,
          cid: CID,
          value: like("3aaaaaaaaaaaa", TARGET).value,
        },
      ],
      cursor: "1",
    };
    const foreign = (uri: string) => json(200, { records: [{ uri, cid: CID, value: {} }] });

    it.each([
      ["a server error", () => json(500, { error: "InternalServerError", message: "boom" })],
      ["a client error", () => json(400, { error: "InvalidRequest", message: "bad cursor" })],
      ["a response without records", () => json(200, {})],
      [
        "a record of another collection",
        () => foreign(`at://${DID}/app.bsky.feed.post/3zzzzzzzzzzzz`),
      ],
      [
        "a record of another repository",
        () => foreign(`at://did:plc:somebody/${collection}/3zzzzzzzzzzzz`),
      ],
      ["a cursor that repeats", () => json(200, { records: [], cursor: "1" })],
    ])("throws, and deletes nothing, after %s", async (_, secondPage) => {
      let pages = 0;
      const { context, requests } = fakeCollection({
        listRecords: () => (++pages === 1 ? json(200, firstPage) : secondPage()),
      });

      await expect(unlikeTarget(context)).rejects.toThrow(
        new RegExp(`^unlike: cannot read all ${collection} records of ${DID}`),
      );

      expect(methods(requests)).not.toContain("com.atproto.repo.deleteRecord");
    });
  });
});

describe("deleting the selected record", () => {
  const collection = "app.certified.feed.like";
  const entries = {
    [collection]: [
      {
        rkey: "3aaaaaaaaaaaa",
        cid: CID,
        value: { $type: collection, subject: { uri: TARGET, cid: OLD_CID }, createdAt: CREATED_AT },
      },
    ],
  };
  const deleteRequests = (requests: Parameters<typeof methods>[0]) =>
    methods(requests).filter((method) => method.endsWith("deleteRecord"));

  it("does not delete when the record changed after it was read (CID conflict), and does not retry", async () => {
    const { context, requests } = fakeCollection({
      entries,
      deleteRecord: () => json(400, { error: "InvalidSwap", message: "Record CID did not match" }),
    });

    const error = await unlike(context, { targetUri: TARGET }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    expect(error.message).toMatch(/no longer has the version .* not deleted/);
    expect(deleteRequests(requests)).toHaveLength(1);
  });

  it("reports an unusable answer as WriteOutcomeUnknownError naming the record, and does not retry", async () => {
    const { context, requests } = fakeCollection({
      entries,
      deleteRecord: () => json(500, { error: "InternalServerError", message: "boom" }),
    });

    const error = await unlike(context, { targetUri: TARGET }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted).toEqual([{ uri: `at://${DID}/${collection}/3aaaaaaaaaaaa`, cid: CID }]);
    expect(deleteRequests(requests)).toHaveLength(1);
  });
});

describe("target validation", () => {
  it("rejects a target of the wrong kind before sending anything", async () => {
    const { context, requests } = fakeCollection();

    await expect(
      unfollowAccount(context, { targetDid: "alice.bsky.social" } as never),
    ).rejects.toThrow(/^unfollowAccount: invalid input: must be an account DID/);
    await expect(unfollowAccount(context, { targetDid: TARGET } as never)).rejects.toThrow(/DID/);
    for (const run of [unfollowEntity, unlike, unrepost]) {
      for (const targetUri of [ACCOUNT, `at://alice.bsky.social/a.b.c/d`, `at://${DID}/a.b.c`]) {
        await expect(run(context, { targetUri })).rejects.toThrow(/must be a full record URI/);
      }
    }

    expect(requests).toHaveLength(0);
  });
});
