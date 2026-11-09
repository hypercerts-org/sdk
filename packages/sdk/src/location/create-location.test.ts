import { describe, expect, it } from "vitest";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { createLocation, type LocationInput } from "./index.js";

const LOCATION = "app.certified.location";
const base = {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
};

describe("createLocation", () => {
  it.each<[string, LocationInput["location"], string[], object]>([
    [
      "inline data",
      { string: "90.17,27.47" },
      [],
      { $type: `${LOCATION}#string`, string: "90.17,27.47" },
    ],
    [
      "a URI to external data, stored as it is",
      { uri: "https://example.org/valley.geojson" },
      [],
      { $type: "org.hypercerts.defs#uri", uri: "https://example.org/valley.geojson" },
    ],
    [
      "a file, uploaded first",
      { blob: new Blob(['{"type":"Point"}'], { type: "application/geo+json" }) },
      ["com.atproto.repo.uploadBlob"],
      {
        $type: "org.hypercerts.defs#smallBlob",
        blob: { mimeType: "application/geo+json", size: 16 },
      },
    ],
  ])("creates a location from %s", async (_, location, uploads, stored) => {
    const { context, requests, creates } = fakeRepo();

    const ref = await createLocation(context, { ...base, location });

    expect(methods(requests)).toEqual([...uploads, "com.atproto.repo.applyWrites"]);
    const write = writeOf(creates[0] ?? [], LOCATION);
    expect(write.value).toMatchObject({ $type: LOCATION, ...base, location: stored });
    expect(ref).toEqual(refTo(write));
  });

  it("accepts a locationType outside the lexicon's known values", async () => {
    const { context, creates } = fakeRepo();

    await createLocation(context, {
      ...base,
      locationType: "plus-code",
      location: { string: "8FVC9G8F+6W" },
    });

    expect(writeOf(creates[0] ?? [], LOCATION).value.locationType).toBe("plus-code");
  });

  it.each<[string, LocationInput["location"]]>([
    ["lowercase", { string: "bt" }],
    ["alpha-3", { string: "BTN" }],
    ["a name", { string: "Bhutan" }],
    ["not inline", { uri: "https://example.org/bt" }],
  ])("rejects a country-code location that is %s, sending nothing", async (_, location) => {
    const { context, requests } = fakeRepo();

    await expect(
      createLocation(context, { ...base, locationType: "country-code", location }),
    ).rejects.toThrow(/uppercase ISO 3166-1 alpha-2/);

    expect(requests).toHaveLength(0);
  });

  it("accepts an uppercase alpha-2 country code", async () => {
    const { context, creates } = fakeRepo();

    await createLocation(context, {
      ...base,
      locationType: "country-code",
      location: { string: "BT" },
    });

    expect(writeOf(creates[0] ?? [], LOCATION).value.location).toMatchObject({ string: "BT" });
  });

  it.each([
    ["not JSON", "90.17,27.47"],
    ["not a Point", '{"type":"Polygon","coordinates":[]}'],
    ["latitude out of range", '{"type":"Point","coordinates":[27.47,95]}'],
    ["missing a coordinate", '{"type":"Point","coordinates":[90.17]}'],
  ])("rejects an inline geojson-point that is %s, sending nothing", async (_, string) => {
    const { context, requests } = fakeRepo();

    await expect(
      createLocation(context, { ...base, locationType: "geojson-point", location: { string } }),
    ).rejects.toThrow(/GeoJSON Point with \[longitude, latitude\]/);

    expect(requests).toHaveLength(0);
  });

  it("accepts an inline geojson-point, with or without altitude", async () => {
    const { context, creates } = fakeRepo();

    for (const coordinates of ["[90.17,27.47]", "[90.17,27.47,2900]"]) {
      await createLocation(context, {
        ...base,
        locationType: "geojson-point",
        location: { string: `{"type":"Point","coordinates":${coordinates}}` },
      });
    }

    expect(creates).toHaveLength(2);
  });

  it("sends nothing when `location` names more than one representation", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createLocation(context, {
        ...base,
        location: { uri: "https://a.example", string: "x" },
      } as never),
    ).rejects.toThrow(/^createLocation: invalid input: .*must be \{ uri: string \}/);

    expect(requests).toHaveLength(0);
  });
});
