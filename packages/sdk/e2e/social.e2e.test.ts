import * as defs from "@hypercerts-org/lexicon/app/certified/defs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/activity/index.js";
import {
  followAccount,
  followEntity,
  like,
  repost,
  unfollowAccount,
  unfollowEntity,
  unlike,
  unrepost,
} from "../src/social/index.js";
import { readE2eEnv } from "./env.js";
import { unique } from "./fixtures.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  collections,
  countRecords,
  deleteStored,
  expectMissing,
  expectStored,
  type Ref,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

// `user` acts. `other` owns the records it acts on: a record of another account is what an
// application's users like and follow, and it is read from that account's own PDS.
let user: Account;
let other: Account;
// An Activity of `other`, and a repost of it by `other`, which `via` points at.
let target: Ref;
let viaRepost: Ref;

// Keeps the records a test creates, so the test deletes them again. They are deleted with the
// client, not with the SDK's undo functions, because some tests are checking those.
function tracker() {
  const records: { account: Account; uri: string }[] = [];
  return {
    add<T extends { uri: string }>(account: Account, ref: T): T {
      records.push({ account, uri: ref.uri });
      return ref;
    },
    release: async () => {
      for (const { account, uri } of records.splice(0)) await deleteStored(account.client, uri);
    },
  };
}
const fixtures = tracker();
const created = tracker();

beforeAll(async () => {
  redirectPlcDirectory(readE2eEnv().plcUrl);
  [user, other] = await Promise.all([loginAs("user1"), loginAs("user2")]);
  expect(other.did, "SDK_E2E_USER2 must be a different account than SDK_E2E_USER1").not.toBe(
    user.did,
  );
  const activity = await createActivity(other.context, {
    title: unique("E2E activity"),
    shortDescription: "Planting native trees",
  });
  target = fixtures.add(other, { uri: activity.uri, cid: activity.cid });
  const reposted = await repost(other.context, { target: { uri: target.uri } });
  viaRepost = fixtures.add(other, { uri: reposted.uri, cid: reposted.cid });
});
afterEach(created.release);
afterAll(async () => {
  vi.unstubAllGlobals();
  await fixtures.release();
});

// A record of `other` that was never written.
const missingUri = () => `at://${other.did}/${collections.activity}/${unique("missing", "-")}`;

// Reads a record the SDK reported, after checking it is in the signed-in account's repo and in
// `collection`, and returns what is stored.
async function storedOwn(ref: Ref, collection: string) {
  expect(ref.uri.startsWith(`at://${user.did}/${collection}/`)).toBe(true);
  return expectStored(user.client, ref);
}

describe("following", () => {
  it("followAccount stores the followed DID as the subject", async () => {
    const follow = created.add(
      user,
      await followAccount(user.context, { target: { did: other.did } }),
    );

    expect(await storedOwn(follow, collections.follow)).toMatchObject({ subject: other.did });
  });

  it("followEntity stores the record's URI as a recordSubject, with no CID", async () => {
    const follow = created.add(
      user,
      await followEntity(user.context, { target: { uri: target.uri } }),
    );

    const stored = await storedOwn(follow, collections.entityFollow);
    expect(stored.subject).toEqual({ $type: defs.recordSubject.$type, uri: target.uri });
  });
});

describe("liking and reposting", () => {
  const reactions = [
    { name: "like", create: like, collection: collections.like },
    { name: "repost", create: repost, collection: collections.repost },
  ];

  it.each(reactions)("$name stores the target's URI and its current CID", async (reaction) => {
    const ref = created.add(
      user,
      await reaction.create(user.context, { target: { uri: target.uri } }),
    );

    expect(await storedOwn(ref, reaction.collection)).toMatchObject({ subject: target });
  });

  it("pins the URI and CID of the `via` record", async () => {
    const ref = created.add(
      user,
      await like(user.context, { target: { uri: target.uri }, via: { uri: viaRepost.uri } }),
    );

    expect(await storedOwn(ref, collections.like)).toMatchObject({
      subject: target,
      via: viaRepost,
    });
  });
});

describe("undoing", () => {
  const actions = [
    {
      name: "unfollowAccount",
      create: () => followAccount(user.context, { target: { did: other.did } }),
      undo: (ref: Ref) => unfollowAccount(user.context, { follow: ref }),
    },
    {
      name: "unfollowEntity",
      create: () => followEntity(user.context, { target: { uri: target.uri } }),
      undo: (ref: Ref) => unfollowEntity(user.context, { follow: ref }),
    },
    {
      name: "unlike",
      create: () => like(user.context, { target: { uri: target.uri } }),
      undo: (ref: Ref) => unlike(user.context, { like: ref }),
    },
    {
      name: "unrepost",
      create: () => repost(user.context, { target: { uri: target.uri } }),
      undo: (ref: Ref) => unrepost(user.context, { repost: ref }),
    },
  ];

  it.each(actions)(
    "$name deletes the record that create returned, passed as it is",
    async (action) => {
      const ref = created.add(user, await action.create());
      await expectStored(user.client, ref);

      await action.undo(ref);

      await expectMissing(user.client, ref.uri);
    },
  );

  // The guard on `cid` and the repeat are the same code for the four functions, so these run
  // through `unlike` only.
  it("deletes the record when the cid it is given is the record's", async () => {
    const liked = created.add(user, await like(user.context, { target: { uri: target.uri } }));

    await unlike(user.context, { like: liked });

    await expectMissing(user.client, liked.uri);
  });

  it("refuses a stale cid with InvalidSwap and leaves the record", async () => {
    const liked = created.add(user, await like(user.context, { target: { uri: target.uri } }));

    // Another record's CID: a valid CID that is not the like's.
    await expect(
      unlike(user.context, { like: { uri: liked.uri, cid: target.cid } }),
    ).rejects.toMatchObject({ name: "WriteRejectedError", code: "InvalidSwap" });

    await expectStored(user.client, liked);
  });

  it("resolves when the record is already gone, with or without the old cid", async () => {
    const liked = created.add(user, await like(user.context, { target: { uri: target.uri } }));
    await unlike(user.context, { like: { uri: liked.uri } });

    await expect(unlike(user.context, { like: { uri: liked.uri } })).resolves.toBeUndefined();
    await expect(unlike(user.context, { like: liked })).resolves.toBeUndefined();
  });

  it("throws TypeError, before sending anything, for another account's record", async () => {
    const theirs = created.add(other, await like(other.context, { target: { uri: target.uri } }));
    const sent: string[] = [];
    const watched = await loginAs("user1", (path, init) => {
      sent.push(path);
      return init;
    });

    await expect(unlike(watched.context, { like: { uri: theirs.uri } })).rejects.toBeInstanceOf(
      TypeError,
    );

    expect(sent).toEqual([]);
    await expectStored(other.client, theirs);
  });
});

// Only a strong reference is read: a like must store the CID of what it points at, so a record that
// cannot be read stops it. A follow stores a DID or a URI as given, so what it points at may not
// exist.
describe("targets that do not exist", () => {
  it("like throws and writes nothing when the record cannot be read", async () => {
    const before = await countRecords(user.client, collections.like);

    await expect(like(user.context, { target: { uri: missingUri() } })).rejects.toThrow(
      /cannot resolve/,
    );

    expect(await countRecords(user.client, collections.like)).toBe(before);
  });

  it("followAccount stores a DID that no account has, as given", async () => {
    const nobody = `did:plc:${"a".repeat(24)}` as const;

    const follow = created.add(
      user,
      await followAccount(user.context, { target: { did: nobody } }),
    );

    expect(await storedOwn(follow, collections.follow)).toMatchObject({ subject: nobody });
  });

  it("followEntity stores the URI of a record that does not exist, as given", async () => {
    const targetUri = missingUri();

    const follow = created.add(
      user,
      await followEntity(user.context, { target: { uri: targetUri } }),
    );

    const stored = await storedOwn(follow, collections.entityFollow);
    expect(stored.subject).toEqual({ $type: defs.recordSubject.$type, uri: targetUri });
  });
});
