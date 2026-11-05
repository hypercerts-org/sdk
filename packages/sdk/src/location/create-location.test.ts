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
      { string: "27.47,90.17" },
      [],
      { $type: `${LOCATION}#string`, string: "27.47,90.17" },
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
