import { Client, isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { createSDKContext } from "../context.js";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  type ActivityInput,
  createActivity,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "./index.js";

const ACTIVITY = "org.hypercerts.claim.activity";
const RIGHTS = "org.hypercerts.claim.rights";
const LOCATION = "app.certified.location";
const CONTRIBUTOR_INFORMATION = "org.hypercerts.claim.contributorInformation";
const CONTRIBUTION = "org.hypercerts.claim.contribution";

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const uriOf = (collection: string) => `at://${DID}/${collection}/3k2a4b5c6d7e8`;
const base = { title: "Trees", shortDescription: "Planting trees" };
const location = {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
};

describe("createActivity", () => {
  it("creates a plain Activity with one applyWrites request", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createActivity(context, base);

    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
    const write = writeOf(creates[0] ?? [], ACTIVITY);
    expect(isTidString(write.rkey)).toBe(true);
    expect(write.value).toMatchObject({ $type: ACTIVITY, ...base });
    expect(write.value.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    // The CID the SDK computed locally is the one the fake PDS computed from the wire bytes. The
    // fake uses the encoder of the reference PDS, so this shows the request survives the wire
    // format unchanged; it says nothing about what a real PDS commits.
    expect(result).toEqual({
      ...refTo(write),
      locations: [],
      contributors: [],
    });
  });

  it("creates nested supporting records, with references that match what is submitted", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createActivity(context, {
      ...base,
      image: png(),
      rights: {
        rightsName: "CC BY",
        rightsType: "CC-BY",
        rightsDescription: "Share with credit",
        attachment: "https://example.com/licence.pdf",
      },
      locations: [{ ...location, name: "Phobjikha" }],
      contributors: [
        {
          identity: { displayName: "Alice", image: png() },
          details: { role: "Lead" },
          weight: "2",
        },
      ],
    });

    // Uploads come first and are not part of the one write.
    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    const writes = creates[0] ?? [];
    expect(writes.map((w) => w.collection)).toEqual([
      RIGHTS,
      LOCATION,
      CONTRIBUTOR_INFORMATION,
      CONTRIBUTION,
      ACTIVITY,
    ]);
    expect(writeOf(writes, RIGHTS).value.attachment).toEqual({
      $type: "org.hypercerts.defs#uri",
      uri: "https://example.com/licence.pdf",
    });
    const [rights, loc, info, contribution] = [
      RIGHTS,
      LOCATION,
      CONTRIBUTOR_INFORMATION,
      CONTRIBUTION,
    ].map((collection) => refTo(writeOf(writes, collection)));
    expect(writeOf(writes, ACTIVITY).value).toMatchObject({
      rights,
      locations: [loc],
      contributors: [
        {
          contributorIdentity: { $type: "com.atproto.repo.strongRef", ...info },
          contributionDetails: { $type: "com.atproto.repo.strongRef", ...contribution },
          contributionWeight: "2",
        },
      ],
    });
    expect(result).toMatchObject({
      rights: { ...rights, created: true },
      locations: [{ ...loc, created: true }],
      contributors: [
        { identity: { ...info, created: true }, details: { ...contribution, created: true } },
      ],
    });
  });

  it("stores a location's external URI as it is and uploads a location file", async () => {
    const { context, requests, creates } = fakeRepo();

    await createActivity(context, {
      ...base,
      locations: [
        { ...location, location: { uri: "https://example.com/a.geojson" } },
        { ...location, location: { blob: new Blob(["{}"], { type: "application/geo+json" }) } },
      ],
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    const [uri, blob] = (creates[0] ?? []).filter((write) => write.collection === LOCATION);
    expect(uri?.value.location).toEqual({
      $type: "org.hypercerts.defs#uri",
      uri: "https://example.com/a.geojson",
    });
    expect(blob?.value.location).toMatchObject({
      $type: "org.hypercerts.defs#smallBlob",
      blob: { $type: "blob", mimeType: "application/geo+json", size: 2 },
    });
  });

  it("reuses an existing location by URI without writing it", async () => {
    const locationUri = uriOf(LOCATION);
    const { context, requests, creates } = fakeRepo({ existing: { [locationUri]: CID } });

    const result = await createActivity(context, { ...base, locations: [{ uri: locationUri }] });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord",
      "com.atproto.repo.applyWrites",
    ]);
    expect(creates[0]).toHaveLength(1);
    expect(writeOf(creates[0] ?? [], ACTIVITY).value.locations).toEqual([
      { uri: locationUri, cid: CID },
    ]);
    expect(result.locations).toEqual([{ uri: locationUri, cid: CID, created: false }]);
  });

  it("mixes new, existing and inline supporting values", async () => {
    const rightsUri = uriOf(RIGHTS);
    const detailsUri = uriOf(CONTRIBUTION);
    const { context, creates } = fakeRepo({ existing: { [rightsUri]: CID, [detailsUri]: CID } });

    const result = await createActivity(context, {
      ...base,
      rights: { uri: rightsUri },
      locations: [location],
      contributors: [
        { identity: { displayName: "Alice" }, details: { uri: detailsUri } },
        { identity: { inline: "did:plc:bob456" }, details: { inline: "Volunteer" } },
      ],
    });

    const writes = creates[0] ?? [];
    expect(writes.map((w) => w.collection)).toEqual([LOCATION, CONTRIBUTOR_INFORMATION, ACTIVITY]);
    const activity = writeOf(writes, ACTIVITY).value;
    expect(activity.rights).toEqual({ uri: rightsUri, cid: CID });
    expect(activity.contributors).toEqual([
      {
        contributorIdentity: {
          $type: "com.atproto.repo.strongRef",
          ...refTo(writeOf(writes, CONTRIBUTOR_INFORMATION)),
        },
        contributionDetails: { $type: "com.atproto.repo.strongRef", uri: detailsUri, cid: CID },
      },
      {
        contributorIdentity: {
          $type: "org.hypercerts.claim.activity#contributorIdentity",
          identity: "did:plc:bob456",
        },
        contributionDetails: {
          $type: "org.hypercerts.claim.activity#contributorRole",
          role: "Volunteer",
        },
      },
    ]);
    // The result mirrors the input: one entry per position, whether created, reused or inline.
    expect(result).toMatchObject({
      rights: { uri: rightsUri, cid: CID, created: false },
      locations: [{ ...refTo(writeOf(writes, LOCATION)), created: true }],
      contributors: [
        {
          identity: { ...refTo(writeOf(writes, CONTRIBUTOR_INFORMATION)), created: true },
          details: { uri: detailsUri, cid: CID, created: false },
        },
        { identity: { inline: "did:plc:bob456" }, details: { inline: "Volunteer" } },
      ],
    });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      "a URI of the wrong record type",
      { ...base, rights: { uri: uriOf(LOCATION) } },
      /rights points at a record of type app\.certified\.location, but this field holds org\.hypercerts\.claim\.rights/,
    ],
    [
      "a URI mixed with record fields",
      { ...base, rights: { uri: uriOf(RIGHTS), rightsName: "x" } },
      /rights combines `uri` with other fields/,
    ],
    [
      "inline where a record is required",
      { ...base, rights: { inline: "ARR" } },
      /rights does not accept \{ inline \}/,
    ],
    [
      "a misspelled field in a new record",
      { ...base, contributors: [{ identity: { displayNam: "Alice" } }] },
      /contributors\[0\]\.identity.*Allowed fields: identifier, displayName, image, createdAt/,
    ],
    [
      "a missing contributor identity",
      { ...base, contributors: [{}] },
      /contributors\[0\]\.identity must be/,
    ],
    [
      "a weight that is not a positive number",
      { ...base, contributors: [{ identity: { inline: "x" }, weight: "0" }] },
      /positive decimal number/,
    ],
    [
      "an end date before the start date",
      { ...base, startDate: "2024-02-01T00:00:00Z", endDate: "2024-01-01T00:00:00Z" },
      /endDate before its startDate/,
    ],
    [
      "an Activity the lexicon rejects",
      { ...base, title: "x".repeat(257) },
      /the Activity is not a valid org\.hypercerts\.claim\.activity record/,
    ],
    [
      "a location value with a misspelled key",
      { ...base, locations: [{ ...location, location: { url: "https://example.com/a.geojson" } }] },
      /locations\[0\].*must be \{ uri: string \}/,
    ],
    [
      "a new record the lexicon rejects",
      { ...base, locations: [{ ...location, locationType: "x".repeat(21) }] },
      /locations\[0\] is not a valid app\.certified\.location record/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createActivity(context, input as unknown as ActivityInput)).rejects.toThrow(
      message,
    );

    expect(requests).toHaveLength(0);
  });

  it("reads existing records before uploading anything", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createActivity(context, { ...base, image: png(), locations: [{ uri: uriOf(LOCATION) }] }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("does not upload an image the lexicon would reject", async () => {
    const { context, requests } = fakeRepo();
    const tooBig = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });

    await expect(createActivity(context, { ...base, image: tooBig })).rejects.toThrow(
      /image cannot be stored as a small image.*Nothing was uploaded/,
    );

    expect(requests).toHaveLength(0);
  });

  it("does not write when an upload fails", async () => {
    const { context, requests } = fakeRepo({
      uploadBlob: () => json(500, { error: "InternalServerError" }),
    });

    await expect(createActivity(context, { ...base, image: png() })).rejects.toThrow(
      /createActivity: could not upload image/,
    );

    expect(methods(requests)).toEqual(["com.atproto.repo.uploadBlob"]);
  });

  it("fails before sending anything when the client is not authenticated", async () => {
    const requests: string[] = [];
    const client = new Client({
      fetchHandler: async (path) => {
        requests.push(path);
        return json(200, {});
      },
    });

    await expect(createActivity(createSDKContext({ client }), base)).rejects.toThrow(
      /createActivity: the client is not authenticated/,
    );

    expect(requests).toEqual([]);
  });
});

describe("createActivity when the write fails", () => {
  const input = {
    ...base,
    rights: { rightsName: "CC BY", rightsType: "CC-BY", rightsDescription: "Share with credit" },
  };
  const attempted = (body: Uint8Array | undefined) =>
    (
      JSON.parse(new TextDecoder().decode(body)).writes as { collection: string; rkey: string }[]
    ).map((w) => `at://${DID}/${w.collection}/${w.rkey}`);

  it("reports a definite rejection and does not retry", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createActivity(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidRequest" });
    expect(error.message).toMatch(/the 2 records were not created/);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });

  it("reports an unknown outcome with every attempted URI and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createActivity(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual(
      attempted(requests[0]?.body),
    );
    expect(error.attempted).toHaveLength(2);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });

  it("reports when the PDS commits different CIDs than the references embed", async () => {
    const { context } = fakeRepo({
      applyWrites: (request) =>
        json(200, {
          results: attempted(request.body).map((uri) => ({
            $type: "com.atproto.repo.applyWrites#createResult",
            uri,
            cid: CID,
          })),
        }),
    });

    await expect(createActivity(context, input)).rejects.toBeInstanceOf(WriteResultMismatchError);
  });
});
