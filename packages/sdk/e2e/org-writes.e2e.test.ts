import type { DidString } from "@atproto/lex";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivity, createRights } from "../src/activity/index.js";
import { addActivityToCollection, createCollection } from "../src/collection/index.js";
import { createSDKContext } from "../src/index.js";
import {
  addActivityToProject,
  createProject,
  PartialWriteError,
  RecordAlreadyExistsError,
  WriteRejectedError,
} from "../src/project/index.js";
import { readE2eEnv } from "./env.js";
import { coordinates, rights, unique } from "./fixtures.js";
import {
  addMember,
  CGS_SERVICE_ID,
  type CgsRequest,
  callCgs,
  claimsOf,
  mustCallCgs,
  registerGroup,
  setRole,
  watchCgs,
} from "./group.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  collections,
  defined,
  expectMissing,
  expectReferencesResolve,
  expectStored,
  type Ref,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

// Every test here writes to a group through a real Certified Group Service (CGS) in the sandbox,
// with the SDK's own `cgsTarget` and the service-auth tokens it asks the PDS for. `owner` (user1)
// registers the group; `member` (user2) writes to it with the role `member`, which may create
// records and replace its own, but not replace another member's (that needs `admin`).
let owner: Account;
let member: Account;
beforeAll(async () => {
  owner = await loginAs("user1");
  member = await loginAs("user2");
});
// The SDK finds the group's PDS in the sandbox's PLC directory, not plc.directory.
beforeEach(() => redirectPlcDirectory(readE2eEnv().plcUrl));
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Registers a group owned by `owner` through CGS and adds `member` to it with the role `member`. */
async function newGroup(): Promise<DidString> {
  const groupDid = await registerGroup(owner, unique("sdk-e2e", "-"));
  await addMember(owner, groupDid, member, "member");
  return groupDid;
}

const refOf = ({ uri, cid }: Ref): Ref => ({ uri, cid });
const activityInput = () => ({
  title: unique("E2E activity"),
  shortDescription: "Planting native trees",
});
const uriOf = (request: CgsRequest) =>
  `at://${request.body.repo}/${request.body.collection}/${request.body.rkey}`;
const itemsOf = (stored: Record<string, unknown>) =>
  stored.items as { itemIdentifier: Ref; itemWeight?: string }[];

describe("a group registered through CGS", () => {
  it("is an account on the sandbox PDS", async () => {
    const groupDid = await newGroup();

    const { pdsUrl } = readE2eEnv();
    const described = await fetch(
      new URL(`/xrpc/com.atproto.repo.describeRepo?repo=${groupDid}`, pdsUrl),
    );
    expect(described.status).toBe(200);
    expect(await described.json()).toMatchObject({ did: groupDid });
  });
});

describe("{ repo: groupDid } with a signed-in member", () => {
  it("createProject writes every record to the group's repository with the CIDs the SDK computed, one request each", async () => {
    const groupDid = await newGroup();
    const own = await snapshotCounts(member.client);
    const requests = watchCgs();

    const result = await createProject(
      member.context,
      {
        title: unique("E2E project"),
        shortDescription: "Restoring the valley's forests",
        location: coordinates,
        tags: [
          { category: "theme", key: unique("forest", "-"), name: "Forest", status: "proposed" },
        ],
      },
      { repo: groupDid },
    );

    // The project, its default Activity, the location and the tag: four records, each its own
    // createRecord request, and every one of them is in the group's repository, not the member's.
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.nsid === "app.certified.group.repo.createRecord")).toBe(true);
    expect(requests.every((r) => r.body.repo === groupDid)).toBe(true);
    expect(await snapshotCounts(member.client)).toEqual(own);

    const stored = await expectStored(member.client, result);
    expect(result.uri).toMatch(new RegExp(`^at://${groupDid}/${collections.collection}/`));
    expect(stored).toMatchObject({ type: "project", title: expect.any(String) });
    await expectReferencesResolve(member.client, stored);
    const activity = defined(result.activities[0]);
    await expectStored(member.client, activity);
    expect(itemsOf(stored)).toEqual([{ itemIdentifier: refOf(activity) }]);
    // Each request wrote one of the records the call reports: the URIs match one to one.
    const written = new Set(requests.map(uriOf));
    expect(written.has(result.uri)).toBe(true);
    expect(written.has(activity.uri)).toBe(true);
  });
});

describe("the service-auth token", () => {
  it("has aud <cgs did>#certified_group_service and the method as lxm, and CGS accepts it", async () => {
    const groupDid = await newGroup();
    const { cgs } = readE2eEnv();
    const requests = watchCgs();

    const ref = await createRights(
      member.context,
      { ...rights, rightsName: unique("Rights") },
      { repo: groupDid },
    );

    const request = defined(requests[0]);
    expect(requests).toHaveLength(1);
    expect(claimsOf(request.token)).toMatchObject({
      iss: member.did,
      aud: `${cgs.did}#${CGS_SERVICE_ID}`,
      lxm: "app.certified.group.repo.createRecord",
    });
    // CGS accepted it: the record is in the group's repository.
    await expectStored(member.client, ref);
  });

  // Proves CGS really checks `aud`, so the aud assertion above is meaningful and not decorative.
  it("is checked: CGS refuses a token whose aud is another service", async () => {
    const groupDid = await newGroup();

    const answer = await callCgs(
      member,
      "app.certified.group.repo.createRecord",
      { repo: groupDid, collection: collections.rights, rkey: "3k2a4b5c6d7e8", record: {} },
      `did:web:other.example#${CGS_SERVICE_ID}`,
    );

    expect(answer.status).toBe(401);
  });
});

describe("addActivityToProject and addActivityToCollection with an existing Activity", () => {
  it("replace the project with one putRecord guarded by the CID that was read", async () => {
    const groupDid = await newGroup();
    const project = await createProject(
      member.context,
      { title: unique("E2E project"), shortDescription: "A project" },
      { repo: groupDid },
    );
    const activity = await createActivity(member.context, activityInput(), { repo: groupDid });
    const requests = watchCgs();

    const result = await addActivityToProject(
      member.context,
      { project: { uri: project.uri }, activity: { uri: activity.uri }, weight: "2" },
      { repo: groupDid },
    );

    const request = defined(requests[0]);
    expect(requests).toHaveLength(1);
    expect(request.nsid).toBe("app.certified.group.repo.putRecord");
    expect(request.body).toMatchObject({ repo: groupDid, swapRecord: project.cid });
    expect(result.uri).toBe(project.uri);
    expect(result.cid).not.toBe(project.cid);
    const stored = await expectStored(member.client, result);
    expect(itemsOf(stored).map((item) => item.itemIdentifier.uri)).toEqual([
      defined(project.activities[0]).uri,
      activity.uri,
    ]);
    expect(itemsOf(stored).at(-1)).toMatchObject({ itemWeight: "2" });
  });

  it("replace a collection the same way", async () => {
    const groupDid = await newGroup();
    const first = await createActivity(member.context, activityInput(), { repo: groupDid });
    const second = await createActivity(member.context, activityInput(), { repo: groupDid });
    const collection = await createCollection(
      member.context,
      { title: unique("E2E collection"), items: [{ uri: first.uri }] },
      { repo: groupDid },
    );
    const requests = watchCgs();

    const result = await addActivityToCollection(
      member.context,
      { collection: { uri: collection.uri }, activity: { uri: second.uri } },
      { repo: groupDid },
    );

    expect(requests.map((r) => r.nsid)).toEqual(["app.certified.group.repo.putRecord"]);
    expect(defined(requests[0]).body.swapRecord).toBe(collection.cid);
    const stored = await expectStored(member.client, result);
    expect(itemsOf(stored).map((item) => item.itemIdentifier.uri)).toEqual([first.uri, second.uri]);
  });
});

describe("a concurrent change", () => {
  it("to the Collection between the SDK's read and its write is refused as WriteRejectedError InvalidSwap, and the other change stays", async () => {
    const groupDid = await newGroup();
    const first = await createActivity(member.context, activityInput(), { repo: groupDid });
    const second = await createActivity(member.context, activityInput(), { repo: groupDid });
    const collection = await createCollection(
      member.context,
      { title: unique("E2E collection"), items: [{ uri: first.uri }] },
      { repo: groupDid },
    );
    const original = await expectStored(member.client, collection);
    let disturbed: Ref | undefined;
    // The SDK has read the Collection and holds its token. The owner replaces the Collection now.
    watchCgs(async (request) => {
      if (request.nsid !== "app.certified.group.repo.putRecord") return;
      const answer = await mustCallCgs<Ref>(owner, "app.certified.group.repo.putRecord", {
        repo: groupDid,
        collection: request.body.collection,
        rkey: request.body.rkey,
        record: { ...original, title: unique("Changed by the owner") },
      });
      disturbed = answer;
    });

    const error = await addActivityToCollection(
      member.context,
      { collection: { uri: collection.uri }, activity: { uri: second.uri } },
      { repo: groupDid },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    // Nothing of the SDK's write is stored: the Collection is the owner's version.
    const stored = await expectStored(member.client, defined(disturbed));
    expect(itemsOf(stored).map((item) => item.itemIdentifier.uri)).toEqual([first.uri]);
  });
});

describe("a write that fails partway", () => {
  // The plan of createProject creates its records one request each. A record of the plan is taken
  // by another member's record at the same key just before its request is sent, which is the only
  // way for a real CGS to refuse one record of a plan after others landed: the key was free when
  // the plan was made, and CGS answers a create at a taken key with an error.
  it("throws PartialWriteError listing what was written, what failed and what was never sent", async () => {
    const groupDid = await newGroup();
    let sent = 0;
    let collider: Ref | undefined;
    const requests = watchCgs(async (request) => {
      if (request.nsid !== "app.certified.group.repo.createRecord" || ++sent !== 3) return;
      collider = await mustCallCgs<Ref>(owner, "app.certified.group.repo.createRecord", {
        ...request.body,
        record: { ...(request.body.record as object), e2eCollision: true },
      });
    });

    const error = await createProject(
      member.context,
      {
        title: unique("E2E project"),
        shortDescription: "Restoring the valley's forests",
        location: coordinates,
        tags: [
          { category: "theme", key: unique("forest", "-"), name: "Forest", status: "proposed" },
        ],
      },
      { repo: groupDid },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    const partial = error as PartialWriteError;
    // The first two requests landed, the third failed, and nothing was sent after it.
    expect(requests).toHaveLength(3);
    expect(partial.written.map((ref) => ref.uri)).toEqual(requests.slice(0, 2).map(uriOf));
    expect(partial.failed.uri).toBe(uriOf(defined(requests[2])));
    expect(partial.failure).toBeInstanceOf(RecordAlreadyExistsError);
    // The plan order is intended: the Project is created last, so it is the one never sent.
    expect(partial.written).toHaveLength(2);
    expect(partial.notAttempted.map((ref) => ref.uri)).toEqual([
      expect.stringContaining(`/${collections.collection}/`),
    ]);
    // The record that failed is the one the other member took.
    expect(partial.failed.uri).toBe(defined(collider).uri);
    expect(partial.attempted).toEqual([
      ...partial.written,
      partial.failed,
      ...partial.notAttempted,
    ]);
    for (const ref of partial.written) await expectStored(member.client, ref);
    // The key holds the other member's record, not the SDK's.
    expect((await expectStored(member.client, defined(collider))).e2eCollision).toBe(true);
    expect(defined(collider).cid).not.toBe(partial.failed.cid);
    for (const ref of partial.notAttempted) await expectMissing(member.client, ref.uri);
  });
});

describe("a member without the role", () => {
  it("is refused with WriteRejectedError 403 when replacing another member's Collection, and may once made an admin", async () => {
    const groupDid = await newGroup();
    const first = await createActivity(owner.context, activityInput(), { repo: groupDid });
    const second = await createActivity(owner.context, activityInput(), { repo: groupDid });
    const collection = await createCollection(
      owner.context,
      { title: unique("E2E collection"), items: [{ uri: first.uri }] },
      { repo: groupDid },
    );
    const add = () =>
      addActivityToCollection(
        member.context,
        { collection: { uri: collection.uri }, activity: { uri: second.uri } },
        { repo: groupDid },
      );

    const error = await add().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 403 });
    const unchanged = await expectStored(member.client, collection);
    expect(itemsOf(unchanged)).toHaveLength(1);

    // The same call works once the role allows it, so the 403 was the role and nothing else.
    await setRole(owner, groupDid, member, "admin");
    const result = await add();
    const stored = await expectStored(member.client, result);
    expect(itemsOf(stored).map((item) => item.itemIdentifier.uri)).toEqual([first.uri, second.uri]);
  });
});

describe("{ repo: ownDid }", () => {
  it("writes to the account's own PDS, with no CGS configured", async () => {
    const context = createSDKContext({ client: member.client });
    const requests = watchCgs();

    const ref = await createRights(
      context,
      { ...rights, rightsName: unique("Rights") },
      { repo: member.did },
    );

    expect(requests).toEqual([]);
    expect(ref.uri).toMatch(new RegExp(`^at://${member.did}/${collections.rights}/`));
    await expectStored(member.client, ref);
  });
});
