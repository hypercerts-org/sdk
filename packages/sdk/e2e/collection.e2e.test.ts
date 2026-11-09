import { toDatetimeString } from "@atproto/lex";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import { beforeAll, describe, expect, it } from "vitest";
import { createActivity, createRights } from "../src/activity/index.js";
import { createActivityInCollection } from "../src/collection/index.js";
import { coordinates, rights, unique } from "./fixtures.js";
import { expectReferencesResolve, expectStored, type Ref, snapshotCounts } from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

const base = () => ({ title: unique("E2E activity"), shortDescription: "Planting native trees" });
const refOnly = ({ uri, cid }: Ref): Ref => ({ uri, cid });

// A Collection that already lists one Activity, as an application or an earlier call left it. There
// is no SDK operation that creates a Collection yet, so the test writes it with the client.
async function seedCollection() {
  const first = await createActivity(user.context, base());
  const input = {
    type: "project",
    title: unique("E2E collection"),
    createdAt: toDatetimeString(new Date("2024-02-01T00:00:00Z")),
    items: [{ itemIdentifier: { uri: first.uri, cid: first.cid }, itemWeight: "1" }],
  };
  const created = await user.client.create(collection.main, input);
  return { ref: refOnly(created), first, input };
}

describe("createActivityInCollection", () => {
  it("stores the Activity, its records and the new version of the Collection together", async () => {
    const seeded = await seedCollection();
    const before = await snapshotCounts(user.client);

    const result = await createActivityInCollection(user.context, {
      collectionUri: seeded.ref.uri,
      activity: { ...base(), rights, locations: [coordinates] },
      itemWeight: "2.5",
    });

    // The Activity and its two new records exist and reference each other by the stored CIDs.
    const activity = await expectStored(user.client, result.activity);
    expect(await expectReferencesResolve(user.client, activity)).toHaveLength(2);
    // The Collection is stored at the CID the SDK reported, under the same URI.
    expect(result.collection.uri).toBe(seeded.ref.uri);
    expect(result.collection.cid).not.toBe(seeded.ref.cid);
    const stored = await expectStored(user.client, result.collection);
    // Everything else is as it was, and the new item is last.
    expect(stored).toEqual({
      $type: collection.main.$type,
      ...seeded.input,
      items: [
        ...seeded.input.items,
        { itemIdentifier: refOnly(result.activity), itemWeight: "2.5" },
      ],
    });
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      activity: before.activity + 1,
      rights: before.rights + 1,
      location: before.location + 1,
    });
  });

  it("writes nothing when another write to the account lands between the read and the write", async () => {
    const seeded = await seedCollection();
    // Just before the SDK sends its write, a second client writes an unrelated record to the same
    // account, which moves the repository past the commit the SDK read.
    let interfered = 0;
    const interfering = await loginAs("user1", async (path, init) => {
      if (path.includes("com.atproto.repo.applyWrites")) {
        interfered += 1;
        await createRights(user.context, rights);
      }
      return init;
    });
    const before = await snapshotCounts(user.client);

    await expect(
      createActivityInCollection(interfering.context, {
        collectionUri: seeded.ref.uri,
        activity: { ...base(), rights, locations: [coordinates] },
      }),
    ).rejects.toMatchObject({ name: "WriteRejectedError", code: "InvalidSwap" });

    expect(interfered, "the applyWrites request was not intercepted").toBe(1);
    // Only the unrelated record exists: no Activity, no supporting records, and the Collection is
    // the version it was.
    expect(await snapshotCounts(user.client)).toEqual({ ...before, rights: before.rights + 1 });
    await expectStored(user.client, seeded.ref);
  });
});
