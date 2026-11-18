import { beforeAll, describe, expect, it } from "vitest";
import { createActivity } from "../src/activity/index.js";
import {
  addActivityToProject,
  createProject,
  RecordAlreadyExistsError,
} from "../src/project/index.js";
import { createVocabularyTag } from "../src/tag/index.js";
import { coordinates, PNG, png, unique } from "./fixtures.js";
import {
  blobIn,
  collections,
  defined,
  expectBlobServed,
  expectReferencesResolve,
  expectStored,
  type Ref,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

const base = () => ({ title: unique("E2E activity"), shortDescription: "Planting native trees" });
const refOnly = ({ uri, cid }: Ref): Ref => ({ uri, cid });

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

describe("createProject without activities", () => {
  it("stores the Project with one default Activity that copies its text and banner and nothing else", async () => {
    const before = await snapshotCounts(user.client);
    const input = {
      title: unique("E2E project"),
      shortDescription: "Restoring the valley's forests",
      shortDescriptionFacets: [
        {
          index: { byteStart: 0, byteEnd: 9 },
          features: [
            { $type: "app.bsky.richtext.facet#link", uri: "https://example.org/valley" } as const,
          ],
        },
      ],
      description: "A longer text about the valley.",
      langs: ["en"],
      avatar: "https://example.org/avatar.png",
      banner: png(),
      location: coordinates,
      tags: [vocabularyTag()],
    };

    const result = await createProject(user.context, input);

    // The Project and every record it points at exist with the CIDs the SDK reported.
    const stored = await expectStored(user.client, result);
    await expectReferencesResolve(user.client, stored);
    expect(stored).toMatchObject({
      type: "project",
      title: input.title,
      shortDescription: input.shortDescription,
      avatar: { uri: input.avatar },
      banner: { $type: "org.hypercerts.defs#largeImage" },
    });
    const defaultActivity = defined(result.activities[0]);
    expect(result.activities).toHaveLength(1);
    expect(defaultActivity.created).toBe(true);
    expect(itemsOf(stored)).toEqual([{ itemIdentifier: refOnly(defaultActivity) }]);
    // The Activity has the Project's text and banner, and no location, tags, avatar or Project date.
    const activity = await expectStored(user.client, defaultActivity);
    expect(activity).toEqual({
      $type: collections.activity,
      title: input.title,
      shortDescription: input.shortDescription,
      shortDescriptionFacets: input.shortDescriptionFacets,
      description: {
        $type: "org.hypercerts.defs#descriptionString",
        value: input.description,
      },
      langs: input.langs,
      image: { $type: "org.hypercerts.defs#smallImage", image: expect.anything() },
      createdAt: expect.any(String),
    });
    // The one uploaded banner is both the Project's banner and the Activity's image.
    const bannerBlob = blobIn(stored.banner, "image");
    const imageBlob = blobIn(activity.image, "image");
    expect(imageBlob.ref.toString()).toBe(bannerBlob.ref.toString());
    await expectBlobServed(user.client, user.did, imageBlob, PNG);
    // One Project, one Activity, the Project's location and tag; nothing else.
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      collection: before.collection + 1,
      activity: before.activity + 1,
      location: before.location + 1,
      vocabularyTag: before.vocabularyTag + 1,
    });
  });
});

describe("createProject with activities", () => {
  it("lists a new Activity and an existing one in order with their weights, and creates no default Activity", async () => {
    const existing = await createActivity(user.context, base());
    const before = await snapshotCounts(user.client);

    const result = await createProject(user.context, {
      title: unique("E2E project"),
      activities: [
        { activity: { ...base(), locations: [coordinates] }, weight: "2" },
        { activity: { uri: existing.uri }, weight: "0.50" },
      ],
    });

    const [created, reused] = result.activities;
    expect(created).toMatchObject({ created: true });
    expect(reused).toEqual({ ...refOnly(existing), created: false });
    const stored = await expectStored(user.client, result);
    await expectReferencesResolve(user.client, stored);
    expect(itemsOf(stored)).toEqual([
      { itemIdentifier: refOnly(defined(created)), itemWeight: "2" },
      { itemIdentifier: refOnly(existing), itemWeight: "0.50" },
    ]);
    // The new Activity holds its new location by reference, and the existing one is as it was.
    const activity = await expectStored(user.client, defined(created));
    expect(await expectReferencesResolve(user.client, activity)).toHaveLength(1);
    await expectStored(user.client, existing);
    // Only the Project, the new Activity and its location are new.
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      collection: before.collection + 1,
      activity: before.activity + 1,
      location: before.location + 1,
    });
  });

  it("creates nothing, the default Activity included, when a new tag's key is taken", async () => {
    const taken = vocabularyTag();
    await createVocabularyTag(user.context, taken);
    const before = await snapshotCounts(user.client);

    await expect(
      createProject(user.context, {
        title: unique("E2E project"),
        shortDescription: "Restoring the valley's forests",
        tags: [taken],
      }),
    ).rejects.toBeInstanceOf(RecordAlreadyExistsError);

    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("addActivityToProject", () => {
  it("stores a new Activity and the new version of the Project together, keeping the rest of it", async () => {
    const project = await createProject(user.context, {
      title: unique("E2E project"),
      shortDescription: "Restoring the valley's forests",
    });
    const before = await expectStored(user.client, project);
    const counts = await snapshotCounts(user.client);

    const result = await addActivityToProject(user.context, {
      project: { uri: project.uri },
      activity: { ...base(), locations: [coordinates] },
      weight: "2",
    });

    // The Activity and its location exist and reference each other by the stored CIDs.
    expect(result.activity.created).toBe(true);
    const activity = await expectStored(user.client, result.activity);
    expect(await expectReferencesResolve(user.client, activity)).toHaveLength(1);
    // The Project is stored at the CID the SDK reported, with its default Activity first and the new
    // one last, and everything else as it was.
    expect(result.uri).toBe(project.uri);
    expect(result.cid).not.toBe(project.cid);
    const stored = await expectStored(user.client, result);
    expect(stored).toEqual({
      ...before,
      items: [...itemsOf(before), { itemIdentifier: refOnly(result.activity), itemWeight: "2" }],
    });
    expect(await snapshotCounts(user.client)).toEqual({
      ...counts,
      activity: counts.activity + 1,
      location: counts.location + 1,
    });
  });
});
