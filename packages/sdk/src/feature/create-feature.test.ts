import { isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, DID } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  createFeature,
  type FeatureInput,
  type LeafletDocument,
  RecordAlreadyExistsError,
} from "./index.js";

const FEATURE = "org.hypercerts.entity.feature";
const VOCAB = "org.hypercerts.vocab.tag";
const WORKSCOPE = "org.hypercerts.workscope.tag";
const LOCATION = "app.certified.location";
const LEAFLET = "pub.leaflet.pages.linearDocument";

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const tag = (category: string, key: string) => ({ category, key, name: key, status: "accepted" });
const location = (name: string) => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
  name,
});

describe("createFeature", () => {
  it("creates a Feature with new, existing and nested tags and locations in one write", async () => {
    const existingTag = uriOf(VOCAB, "land-cover.wetland");
    const existingLocation = uriOf(LOCATION);
    const { context, requests, creates } = fakeRepo({
      existing: { [existingTag]: CID, [existingLocation]: CID },
    });

    const result = await createFeature(context, {
      type: "zone",
      title: "Phobjikha zone",
      description: "The valley floor.",
      langs: ["en"],
      sameAs: ["https://example.org/parcel/42"],
      tags: [
        { ...tag("zone-role", "site"), broader: [tag("zone-role", "area")] },
        { uri: existingTag },
      ],
      locations: [{ uri: existingLocation }, location("coarse")],
    });

    // The existing records and the new tag keys are read first; nothing is uploaded.
    expect(methods(requests).at(-1)).toBe("com.atproto.repo.applyWrites");
    expect(
      methods(requests)
        .slice(0, -1)
        .every((m) => m === "com.atproto.repo.getRecord"),
    ).toBe(true);
    const writes = creates[0] ?? [];
    // Locations, then tags with a tag's broader tag before it, then the Feature.
    expect(writes.map((write) => write.collection)).toEqual([LOCATION, VOCAB, VOCAB, FEATURE]);
    expect(writes.slice(1, 3).map((write) => write.rkey)).toEqual([
      "zone-role.area",
      "zone-role.site",
    ]);
    const feature = writeOf(writes, FEATURE);
    expect(isTidString(feature.rkey)).toBe(true);
    const [coarse, area, site] = writes.slice(0, 3).map(refTo);
    expect(feature.value).toMatchObject({
      $type: FEATURE,
      type: "zone",
      title: "Phobjikha zone",
      description: { $type: "org.hypercerts.defs#descriptionString", value: "The valley floor." },
      langs: ["en"],
      sameAs: ["https://example.org/parcel/42"],
      tags: [site, { uri: existingTag, cid: CID }],
      locations: [{ uri: existingLocation, cid: CID }, coarse],
    });
    expect(result).toEqual({
      ...refTo(feature),
      tags: [
        { ...site, created: true, broader: [{ ...area, created: true }] },
        { uri: existingTag, cid: CID, created: false },
      ],
      locations: [
        { uri: existingLocation, cid: CID, created: false },
        { ...coarse, created: true },
      ],
    });
  });

  it("creates a bare Feature, and keeps an empty locations array", async () => {
    const { context, creates } = fakeRepo();

    const result = await createFeature(context, { title: "Zone", locations: [] });

    const feature = writeOf(creates[0] ?? [], FEATURE);
    expect(feature.value.locations).toEqual([]);
    expect(feature.value.tags).toBeUndefined();
    expect(result).toEqual({ ...refTo(feature), tags: [], locations: [] });
  });

  it("uploads a new location's file before the one write", async () => {
    const { context, requests } = fakeRepo();

    await createFeature(context, {
      title: "Zone",
      locations: [
        {
          ...location("shape"),
          location: { blob: new Blob(["{}"], { type: "application/geo+json" }) },
        },
      ],
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
  });
});

describe("createFeature description", () => {
  const document: LeafletDocument = { $type: LEAFLET, blocks: [] };

  it.each<[string, FeatureInput["description"], object]>([
    [
      "a string",
      "Plain text.",
      { $type: "org.hypercerts.defs#descriptionString", value: "Plain text." },
    ],
    ["a Leaflet document, as it is", document, document],
    [
      "{ uri } of a record of any type, as a strong reference",
      { uri: uriOf("pub.leaflet.document") },
      { $type: "com.atproto.repo.strongRef", uri: uriOf("pub.leaflet.document"), cid: CID },
    ],
  ])("stores %s", async (_, description, stored) => {
    const { context, creates } = fakeRepo({ existing: { [uriOf("pub.leaflet.document")]: CID } });

    await createFeature(context, { title: "Zone", description });

    expect(writeOf(creates[0] ?? [], FEATURE).value.description).toEqual(stored);
  });

  it.each<[string, unknown, RegExp]>([
    ["a Leaflet document without its $type", { blocks: [] }, /must be a string, \{ uri \}/],
    [
      "a Leaflet document with invalid blocks",
      { $type: LEAFLET, blocks: "not blocks" },
      /input is not a valid org\.hypercerts\.entity\.feature record/,
    ],
    [
      "{ uri } mixed with other fields",
      { uri: uriOf("pub.leaflet.document"), blocks: [] },
      /input\.description combines `uri` with other fields/,
    ],
    ["a number", 7, /must be a string, \{ uri \}/],
  ])("sends nothing for %s", async (_, description, message) => {
    const { context, requests } = fakeRepo({ existing: { [uriOf("pub.leaflet.document")]: CID } });

    await expect(
      createFeature(context, { title: "Zone", description } as FeatureInput),
    ).rejects.toThrow(message);

    expect(methods(requests).includes("com.atproto.repo.applyWrites")).toBe(false);
  });
});

describe("createFeature when something is wrong", () => {
  it.each<[string, FeatureInput, RegExp]>([
    [
      "a work-scope tag where a vocabulary tag is needed",
      { title: "Zone", tags: [{ uri: uriOf(WORKSCOPE) }] },
      /input\.tags\[0\] points at a record of type org\.hypercerts\.workscope\.tag, but this field holds org\.hypercerts\.vocab\.tag/,
    ],
    [
      "a vocabulary tag where a location is needed",
      { title: "Zone", locations: [{ uri: uriOf(VOCAB, "a.b") }] },
      /input\.locations\[0\] points at a record of type org\.hypercerts\.vocab\.tag, but this field holds app\.certified\.location/,
    ],
    [
      "a misspelled field in a nested tag",
      { title: "Zone", tags: [{ ...tag("a", "b"), broder: [] } as never] },
      /input\.tags\[0\].*Allowed fields: category, key, status, name,/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createFeature(context, input)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("reads a new tag's taken key first and writes and uploads nothing", async () => {
    const taken = uriOf(VOCAB, "zone-role.site");
    const { context, requests } = fakeRepo({ existing: { [taken]: CID } });

    const error = await createFeature(context, {
      title: "Zone",
      tags: [tag("zone-role", "site")],
      locations: [
        {
          ...location("shape"),
          location: { blob: new Blob(["{}"], { type: "application/geo+json" }) },
        },
      ],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toMatchObject({ uri: taken, attempted: [] });
    expect(error.message).toContain("input.tags[0]");
    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });
});
