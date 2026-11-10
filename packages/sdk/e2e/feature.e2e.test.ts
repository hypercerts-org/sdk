import { beforeAll, describe, expect, it } from "vitest";
import { createRights } from "../src/activity/index.js";
import { createFeature } from "../src/feature/index.js";
import { createLocation } from "../src/location/index.js";
import { createVocabularyTag, RecordAlreadyExistsError } from "../src/tag/index.js";
import { coordinates, rights, unique } from "./fixtures.js";
import {
  blobIn,
  collections,
  defined,
  expectBlobServed,
  expectReferencesResolve,
  expectStored,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

const tag = (category: string, key: string) => ({
  category,
  key,
  name: unique("Tag"),
  status: "accepted",
});

describe("createFeature", () => {
  it("stores the Feature with new and existing tags and locations, in order, and every reference resolves", async () => {
    const existingTag = await createVocabularyTag(
      user.context,
      tag("land-cover", unique("wetland", "-")),
    );
    const existingLocation = await createLocation(user.context, {
      ...coordinates,
      name: unique("Coarse"),
    });
    const site = new TextEncoder().encode('{"type":"Point","coordinates":[90.17,27.47]}');
    const before = await snapshotCounts(user.client);

    const result = await createFeature(user.context, {
      type: "zone",
      title: unique("Phobjikha zone"),
      description: "The valley floor.",
      langs: ["en"],
      tags: [
        {
          ...tag("zone-role", unique("site", "-")),
          broader: [tag("zone-role", unique("area", "-"))],
        },
        { uri: existingTag.uri },
      ],
      locations: [
        {
          ...coordinates,
          locationType: "geojson-point",
          location: { blob: new File([site], "site.geojson", { type: "application/geo+json" }) },
        },
        { uri: existingLocation.uri },
      ],
    });

    const stored = await expectStored(user.client, result);
    expect(stored).toMatchObject({
      type: "zone",
      description: { $type: "org.hypercerts.defs#descriptionString", value: "The valley floor." },
      langs: ["en"],
      tags: [{ uri: defined(result.tags[0]).uri }, { uri: existingTag.uri, cid: existingTag.cid }],
      locations: [{ uri: defined(result.locations[0]).uri }, { uri: existingLocation.uri }],
    });
    await expectReferencesResolve(user.client, stored);
    await expectStored(user.client, defined(defined(result.tags[0]).broader?.[0]));
    const newLocation = await expectStored(user.client, defined(result.locations[0]));
    await expectBlobServed(user.client, user.did, blobIn(newLocation.location, "blob"), site);
    expect(result.tags.map((entry) => entry.created)).toEqual([true, false]);
    expect(result.locations.map((entry) => entry.created)).toEqual([true, false]);
    // The Feature, two new tags and the new location. The reused records were not written again.
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      feature: before.feature + 1,
      vocabularyTag: before.vocabularyTag + 2,
      location: before.location + 1,
    });
  });

  it("stores a description that points at an existing record of another type as a strong reference", async () => {
    const target = await createRights(user.context, rights);

    const result = await createFeature(user.context, {
      title: unique("Zone"),
      description: { uri: target.uri },
      locations: [],
    });

    const stored = await expectStored(user.client, result);
    expect(stored).toMatchObject({
      description: { $type: "com.atproto.repo.strongRef", uri: target.uri, cid: target.cid },
      locations: [],
    });
    await expectReferencesResolve(user.client, stored);
  });

  it("stores a Leaflet document as it is", async () => {
    const document = { $type: "pub.leaflet.pages.linearDocument" as const, blocks: [] };

    const result = await createFeature(user.context, {
      title: unique("Zone"),
      description: document,
    });

    expect(await expectStored(user.client, result)).toMatchObject({ description: document });
  });

  it("creates nothing when a new tag's key is taken", async () => {
    const key = unique("site", "-");
    await createVocabularyTag(user.context, tag("zone-role", key));
    const before = await snapshotCounts(user.client);

    const error = await createFeature(user.context, {
      title: unique("Zone"),
      tags: [tag("zone-role", key)],
      locations: [{ ...coordinates, name: unique("Shape") }],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error.uri).toBe(`at://${user.did}/${collections.vocabularyTag}/zone-role.${key}`);
    expect(await snapshotCounts(user.client)).toEqual(before);
  });

  it("throws a TypeError for a work-scope tag where a vocabulary tag is needed and writes nothing", async () => {
    const before = await snapshotCounts(user.client);

    await expect(
      createFeature(user.context, {
        title: unique("Zone"),
        tags: [{ uri: `at://${user.did}/${collections.workScopeTag}/3jzfcijpj2z2a` }],
      }),
    ).rejects.toMatchObject({
      name: "TypeError",
      message: expect.stringMatching(/this field holds org\.hypercerts\.vocab\.tag/),
    });

    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});
