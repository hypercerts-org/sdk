import { toDatetimeString } from "@atproto/lex";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActivity, createRights } from "../src/activity/index.js";
import { createActivityInCollection, createCollection } from "../src/collection/index.js";
import { createFeature } from "../src/feature/index.js";
import { readE2eEnv } from "./env.js";
import { coordinates, rights, unique } from "./fixtures.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  collections,
  defined,
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

// A vocabulary tag's key is chosen by the caller and cannot be reused, so every run uses a new one.
const vocabularyTag = () => ({
  category: "theme",
  key: unique("forest", "-"),
  name: unique("Forest"),
  status: "proposed",
});

// The items a stored Collection lists, as the strong references and weights it holds.
const itemsOf = (stored: Record<string, unknown>) =>
  stored.items as { itemIdentifier: Ref; itemWeight?: string }[];

describe("createCollection with new records", () => {
  it("stores the Collection, its nested records and a child Collection in one write, and every reference resolves", async () => {
    const existing = await createActivity(user.context, base());
    const before = await snapshotCounts(user.client);

    const result = await createCollection(user.context, {
      type: "portfolio",
      title: unique("E2E collection"),
      description: "Everything we do in the valley.",
      location: coordinates,
      tags: [vocabularyTag()],
      items: [
        {
          activity: {
            ...base(),
            locations: [coordinates],
            // Inline: stored in the Activity, no record of its own.
            contributors: [{ identity: { inline: "did:plc:bob456" }, details: { inline: "Lead" } }],
          },
          weight: "2",
        },
        { feature: { type: "zone", title: unique("E2E feature") } },
        {
          collection: {
            title: unique("E2E child collection"),
            items: [{ uri: existing.uri, weight: "0.5" }],
          },
        },
      ],
    });

    // The Collection and every record it points at exist with the CIDs the SDK reported.
    const stored = await expectStored(user.client, result);
    await expectReferencesResolve(user.client, stored);
    const [activityItem, featureItem, childItem] = result.items;
    expect(result.items.map(({ type, created }) => [type, created])).toEqual([
      ["activity", true],
      ["feature", true],
      ["collection", true],
    ]);
    expect(itemsOf(stored)).toEqual([
      { itemIdentifier: refOnly(defined(activityItem)), itemWeight: "2" },
      { itemIdentifier: refOnly(defined(featureItem)) },
      { itemIdentifier: refOnly(defined(childItem)) },
    ]);

    // The new Activity holds its new location by reference and its contributor inline.
    const activity = await expectStored(user.client, defined(activityItem));
    expect(await expectReferencesResolve(user.client, activity)).toHaveLength(1);
    expect(activity.contributors).toEqual([
      {
        contributorIdentity: {
          $type: "org.hypercerts.claim.activity#contributorIdentity",
          identity: "did:plc:bob456",
        },
        contributionDetails: {
          $type: "org.hypercerts.claim.activity#contributorRole",
          role: "Lead",
        },
      },
    ]);

    // The child Collection lists the existing Activity at the version that was read.
    const child = await expectStored(user.client, defined(childItem));
    expect(itemsOf(child)).toEqual([{ itemIdentifier: refOnly(existing), itemWeight: "0.5" }]);

    // Two Collections, one Activity, one Feature, two locations and one tag; nothing else.
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      collection: before.collection + 2,
      activity: before.activity + 1,
      feature: before.feature + 1,
      location: before.location + 2,
      vocabularyTag: before.vocabularyTag + 1,
    });
  });

  it("mixes new and reused records: a new Activity at an existing location, and an existing Feature", async () => {
    const seed = await createActivity(user.context, { ...base(), locations: [coordinates] });
    const location = refOnly(defined(seed.locations[0]));
    const feature = await createFeature(user.context, { title: unique("E2E feature") });
    const before = await snapshotCounts(user.client);

    const result = await createCollection(user.context, {
      title: unique("E2E collection"),
      location: { uri: location.uri },
      items: [
        { activity: { ...base(), locations: [{ uri: location.uri }] } },
        { uri: feature.uri },
      ],
    });

    expect(result.location).toEqual({ ...location, created: false });
    const [activityItem, featureItem] = result.items;
    expect(featureItem).toEqual({ ...refOnly(feature), type: "feature", created: false });
    expect(activityItem).toMatchObject({ type: "activity", created: true });
    // The new Activity points at the reused location, not a copy of it.
    const activity = await expectStored(user.client, defined(activityItem));
    expect(await expectReferencesResolve(user.client, activity)).toEqual([location]);
    const stored = await expectStored(user.client, result);
    expect(itemsOf(stored)).toEqual([
      { itemIdentifier: refOnly(defined(activityItem)) },
      { itemIdentifier: refOnly(feature) },
    ]);
    // Only the Collection and the Activity are new.
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      collection: before.collection + 1,
      activity: before.activity + 1,
    });
  });
});

describe("createCollection reusing another account's records", () => {
  beforeAll(() => redirectPlcDirectory(readE2eEnv().plcUrl));
  afterAll(() => vi.unstubAllGlobals());

  it("lists them at the version it read without writing to either account's copies", async () => {
    const other = await loginAs("user2");
    expect(other.did, "SDK_E2E_USER2 must be a different account than SDK_E2E_USER1").not.toBe(
      user.did,
    );
    const theirs = await createActivity(other.context, { ...base(), locations: [coordinates] });
    const theirLocation = refOnly(defined(theirs.locations[0]));
    const userBefore = await snapshotCounts(user.client);
    const otherBefore = await snapshotCounts(other.client);

    const result = await createCollection(user.context, {
      title: unique("E2E collection"),
      location: { uri: theirLocation.uri },
      items: [{ uri: theirs.uri, weight: "1" }],
    });

    expect(result.location).toEqual({ ...theirLocation, created: false });
    expect(result.items).toEqual([{ ...refOnly(theirs), type: "activity", created: false }]);
    const stored = await expectStored(user.client, result);
    await expectReferencesResolve(user.client, stored);
    expect(itemsOf(stored)).toEqual([{ itemIdentifier: refOnly(theirs), itemWeight: "1" }]);
    expect(await snapshotCounts(user.client)).toEqual({
      ...userBefore,
      collection: userBefore.collection + 1,
    });
    expect(await snapshotCounts(other.client)).toEqual(otherBefore);
  });
});

describe("createCollection when the PDS rejects one record of the write", () => {
  // Gives the Feature in an applyWrites request the record key of `taken`, a Feature that already
  // exists, so the PDS must refuse that one create. Counts the requests it changed.
  function collideFeatureWith(taken: Ref): RewriteRequest & { rewritten: number } {
    const rkey = defined(taken.uri.split("/").at(-1));
    const rewrite = (path: string, init: RequestInit): RequestInit => {
      if (!path.includes("com.atproto.repo.applyWrites") || typeof init.body !== "string") {
        return init;
      }
      const body = JSON.parse(init.body) as { writes: { collection: string; rkey: string }[] };
      const write = defined(body.writes.find((w) => w.collection === collections.feature));
      write.rkey = rkey;
      rewrite.rewritten += 1;
      return { ...init, body: JSON.stringify(body) };
    };
    rewrite.rewritten = 0;
    return rewrite;
  }

  it("creates none of the records, nested ones included", async () => {
    const taken = await createFeature(user.context, { title: unique("E2E feature") });
    const rewrite = collideFeatureWith(taken);
    const tampered = await loginAs("user1", rewrite);
    const before = await snapshotCounts(user.client);

    // The PDS answers a create on an existing record key with HTTP 500, so the outcome is unknown
    // to the SDK; the counts show nothing was written.
    await expect(
      createCollection(tampered.context, {
        title: unique("E2E collection"),
        location: coordinates,
        items: [
          { activity: { ...base(), locations: [coordinates] } },
          { feature: { title: unique("E2E feature") } },
          { collection: { title: unique("E2E child collection") } },
        ],
      }),
    ).rejects.toMatchObject({ name: "WriteOutcomeUnknownError" });

    expect(rewrite.rewritten, "the applyWrites request was not changed").toBe(1);
    expect(await snapshotCounts(user.client)).toEqual(before);
    await expectStored(user.client, taken);
  });
});
