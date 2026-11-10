import { describe, expect, it } from "vitest";
import { CID, DID, fakePds, json } from "../test-utils/fake-pds.js";
import { fakeRepo, HEAD, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  type CreateOrganizationInput,
  createOrganization,
  type LeafletDocument,
  type LocationInput,
  OrganizationAlreadyExistsError,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const PROFILE = "app.certified.actor.profile";
const ORGANIZATION = "app.certified.actor.organization";
const LOCATION = "app.certified.location";
const LEAFLET = "pub.leaflet.pages.linearDocument";
const PROFILE_URI = `at://${DID}/${PROFILE}/self`;
const ORGANIZATION_URI = `at://${DID}/${ORGANIZATION}/self`;
const MiB = 1024 * 1024;
// CIDv1 (raw, sha-256) of the bytes "other": a head the repo moved to after it was read.
const OTHER_HEAD = "bafkreigzfgfbbunqonmdpxcl3bo2yza3b46o6j5epzovhjkpf47vwl6p7i";

const HEAD_METHOD = "com.atproto.sync.getLatestCommit";
const READ = "com.atproto.repo.getRecord";
const UPLOAD = "com.atproto.repo.uploadBlob";
const WRITE = "com.atproto.repo.applyWrites";

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const png = (size = 3) => new Blob([new Uint8Array(size)], { type: "image/png" });
const location = (name: string): LocationInput => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
  name,
});
const withProfile = { [PROFILE_URI]: CID };

describe("createOrganization", () => {
  it("creates the profile, the new locations and the organization in one request, after reading the head and both singletons", async () => {
    const reused = uriOf(LOCATION, "3k2a4b5c6d7e9");
    const { context, requests, creates, swapCommits } = fakeRepo({ existing: { [reused]: CID } });

    const result = await createOrganization(context, {
      organization: {
        legalName: "Phobjikha Conservation Society",
        publicEmail: "hello@example.org",
        organizationType: ["ngo", "cooperative"],
        urls: [
          { url: "https://example.org/donate", label: "Donate" },
          { url: "https://example.org" },
        ],
        logo: png(),
        foundedDate: "2005-01-01T00:00:00.000Z",
        langs: ["en"],
        visibility: "public",
        longDescription: "We plant native trees.",
        location: location("Head office"),
        additionalLocations: [{ uri: reused }, location("Field office")],
      },
      profileIfMissing: {
        displayName: "Phobjikha Conservation",
        avatar: png(),
        banner: "https://example.org/banner.png",
      },
    });

    // Everything is read first, the logo and the fallback avatar are uploaded, and one request writes.
    expect(methods(requests)).toEqual([
      HEAD_METHOD,
      READ, // the profile
      READ, // the organization
      READ, // the existing location
      UPLOAD,
      UPLOAD,
      WRITE,
    ]);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.collection)).toEqual([
      PROFILE,
      LOCATION,
      LOCATION,
      ORGANIZATION,
    ]);
    expect(swapCommits).toEqual([HEAD]);
    const [profile, office, field, organization] = writes;
    expect([profile?.rkey, organization?.rkey]).toEqual(["self", "self"]);
    expect(profile?.value).toMatchObject({
      displayName: "Phobjikha Conservation",
      avatar: { $type: "org.hypercerts.defs#smallImage" },
      banner: { $type: "org.hypercerts.defs#uri", uri: "https://example.org/banner.png" },
    });
    expect(organization?.value).toMatchObject({
      legalName: "Phobjikha Conservation Society",
      publicEmail: "hello@example.org",
      organizationType: ["ngo", "cooperative"],
      urls: [
        { url: "https://example.org/donate", label: "Donate" },
        { url: "https://example.org" },
      ],
      logo: { $type: "org.hypercerts.defs#smallImage", image: { mimeType: "image/png", size: 3 } },
      foundedDate: "2005-01-01T00:00:00.000Z",
      langs: ["en"],
      visibility: "public",
      longDescription: {
        $type: "org.hypercerts.defs#descriptionString",
        value: "We plant native trees.",
      },
      location: refTo(office as never),
      additionalLocations: [{ uri: reused, cid: CID }, refTo(field as never)],
    });
    // The result carries the exact URIs and CIDs the PDS computed for what it received.
    expect(result).toEqual({
      organization: refTo(organization as never),
      profile: { ...refTo(profile as never), created: true },
      location: { ...refTo(office as never), created: true },
      additionalLocations: [
        { uri: reused, cid: CID, created: false },
        { ...refTo(field as never), created: true },
      ],
    });
  });

  it.each<[string, CreateOrganizationInput["profileIfMissing"]]>([
    ["with fallback data", { displayName: "Not an update", avatar: png(), banner: png() }],
    ["without fallback data", undefined],
  ])(
    "reuses an existing profile unchanged, uploads none of its fallback images and writes only the organization, %s",
    async (_, profileIfMissing) => {
      const { context, requests, creates } = fakeRepo({ existing: withProfile });

      const result = await createOrganization(context, {
        organization: { legalName: "Acme" },
        profileIfMissing,
      });

      expect(methods(requests)).toEqual([HEAD_METHOD, READ, READ, WRITE]);
      expect((creates[0] ?? []).map((write) => write.collection)).toEqual([ORGANIZATION]);
      expect(result).toEqual({
        organization: refTo(writeOf(creates[0] ?? [], ORGANIZATION)),
        profile: { uri: PROFILE_URI, cid: CID, created: false },
      });
    },
  );

  it("stores the logo as a URL without fetching it, and limits an uploaded logo to 5 MB before uploading", async () => {
    const { context, requests, creates } = fakeRepo({ existing: withProfile });

    await createOrganization(context, {
      organization: { logo: "https://example.org/logo.png" },
    });
    expect(writeOf(creates[0] ?? [], ORGANIZATION).value.logo).toEqual({
      $type: "org.hypercerts.defs#uri",
      uri: "https://example.org/logo.png",
    });
    expect(methods(requests)).not.toContain(UPLOAD);

    await expect(
      createOrganization(context, { organization: { logo: png(6 * MiB) } }),
    ).rejects.toThrow(/organization\.logo cannot be stored as a small image/);
    expect(methods(requests)).not.toContain(UPLOAD);
    expect(creates).toHaveLength(1);
  });
});

describe("createOrganization locations", () => {
  const first = uriOf(LOCATION, "3k2a4b5c6d7e1");
  const second = uriOf(LOCATION, "3k2a4b5c6d7e2");

  it("keeps the primary and the additional locations apart, in order, and neither deduplicates nor rewrites existing ones", async () => {
    const { context, creates } = fakeRepo({
      existing: { ...withProfile, [first]: CID, [second]: CID },
    });

    const result = await createOrganization(context, {
      organization: {
        location: { uri: first },
        additionalLocations: [{ uri: first }, location("A"), { uri: second }, location("B")],
      },
    });

    const writes = creates[0] ?? [];
    // Only the two new locations and the organization are written; the existing records are not.
    expect(writes.map((write) => write.collection)).toEqual([LOCATION, LOCATION, ORGANIZATION]);
    const [a, b] = writes.map(refTo);
    expect(writes[2]?.value).toMatchObject({
      location: { uri: first, cid: CID },
      additionalLocations: [{ uri: first, cid: CID }, a, { uri: second, cid: CID }, b],
    });
    expect(result.location).toEqual({ uri: first, cid: CID, created: false });
    expect(result.additionalLocations?.map(({ created }) => created)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("uploads and writes nothing when an existing location cannot be read", async () => {
    const { context, requests } = fakeRepo({ existing: withProfile });

    await expect(
      createOrganization(context, {
        organization: { logo: png(), location: { uri: first } },
      }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).not.toContain(UPLOAD);
    expect(methods(requests)).not.toContain(WRITE);
  });
});

describe("createOrganization longDescription", () => {
  const document: LeafletDocument = { $type: LEAFLET, blocks: [] };
  const documentUri = uriOf("pub.leaflet.document");

  it.each<[string, unknown, object, unknown]>([
    [
      "a string, inline",
      "Plain text.",
      { $type: "org.hypercerts.defs#descriptionString", value: "Plain text." },
      undefined,
    ],
    ["a Leaflet document, inline and as it is", document, document, undefined],
    [
      "{ uri } as a strong reference to the record, which is read and never created",
      { uri: documentUri },
      { $type: "com.atproto.repo.strongRef", uri: documentUri, cid: CID },
      { uri: documentUri, cid: CID, created: false },
    ],
  ])("stores %s", async (_, longDescription, stored, reported) => {
    const { context, requests, creates } = fakeRepo({
      existing: { ...withProfile, [documentUri]: CID },
    });

    const result = await createOrganization(context, {
      organization: { longDescription: longDescription as LeafletDocument },
    });

    expect(writeOf(creates[0] ?? [], ORGANIZATION).value.longDescription).toEqual(stored);
    expect(creates[0]).toHaveLength(1);
    expect(result.longDescription).toEqual(reported);
    expect(methods(requests).filter((method) => method === READ)).toHaveLength(
      reported === undefined ? 2 : 3,
    );
  });
});

describe("createOrganization when the organization or the profile is missing", () => {
  it("throws OrganizationAlreadyExistsError before uploading anything when the account has an organization", async () => {
    const { context, requests } = fakeRepo({
      existing: { ...withProfile, [ORGANIZATION_URI]: CID },
    });

    const error = await createOrganization(context, {
      organization: { logo: png(), location: location("HQ") },
      profileIfMissing: { avatar: png() },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrganizationAlreadyExistsError);
    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({
      uri: ORGANIZATION_URI,
      status: 400,
      code: "InvalidSwap",
      attempted: [],
    });
    expect(error.message).toMatch(/never overwrites/);
    expect(methods(requests)).toEqual([HEAD_METHOD, READ, READ]);
  });

  it("throws a TypeError naming profileIfMissing before uploading anything when the account has no profile and none is given", async () => {
    const { context, requests } = fakeRepo();

    const error = await createOrganization(context, {
      organization: { logo: png(), location: location("HQ") },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/has no profile .*no profileIfMissing.*nothing was uploaded/s);
    expect(methods(requests)).toEqual([HEAD_METHOD, READ, READ]);
  });
});

describe("createOrganization when a read fails", () => {
  const notFound = () => json(400, { error: "RecordNotFound", message: "not found" });

  // A PDS that answers the read of one collection with `failure` and every other record as absent.
  const pdsFailingToRead = (collection: string, failure: () => Response) =>
    fakePds((request) => {
      const url = new URL(request.path, "https://pds.test");
      if (url.pathname.endsWith(HEAD_METHOD)) return json(200, { cid: HEAD, rev: "3k2a4b5c6d7e8" });
      if (!url.pathname.endsWith(READ)) return json(500, { error: "Unexpected", message: "no" });
      return url.searchParams.get("collection") === collection ? failure() : notFound();
    });

  it.each([
    ["the profile", PROFILE],
    ["the organization", ORGANIZATION],
  ])("never takes a failed read of %s as absence", async (_, collection) => {
    const failures = [
      json(500, { error: "InternalServerError", message: "down" }),
      json(403, { error: "Forbidden", message: "not allowed" }),
    ];
    for (const failure of failures) {
      const { context, requests } = pdsFailingToRead(collection, () => failure.clone());

      const error = await createOrganization(context, {
        organization: { logo: png() },
        profileIfMissing: { displayName: "Acme", avatar: png() },
      }).catch((e) => e);

      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(WriteRejectedError);
      expect(error.message).toMatch(
        new RegExp(`cannot check whether at://${DID}/${collection}/self exists`),
      );
      // Nothing beyond the head and the two reads was sent: no upload and no write.
      expect(methods(requests)).toEqual([HEAD_METHOD, READ, READ]);
    }
  });

  it("does not read anything else when the latest commit cannot be read", async () => {
    const { context, requests } = fakeRepo({
      getLatestCommit: () => json(500, { error: "InternalServerError", message: "down" }),
    });

    await expect(
      createOrganization(context, { organization: {}, profileIfMissing: {} }),
    ).rejects.toThrow(/cannot read the latest commit/);

    expect(methods(requests)).toEqual([HEAD_METHOD]);
  });
});

describe("createOrganization when the write does not go through", () => {
  const input: CreateOrganizationInput = {
    organization: { location: location("HQ") },
    profileIfMissing: { displayName: "Acme" },
  };

  it("rejects the whole write when the repository changed after it was read, as when another call created the organization or the profile first", async () => {
    const { context, requests, creates } = fakeRepo({
      onRequest: (method, state) => {
        // The other write lands after the head was read, while the profile is being read.
        if (method === READ) state.head = OTHER_HEAD;
      },
    });

    const error = await createOrganization(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).not.toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    expect(error.message).toMatch(/the repository changed since it was read.*Call again/);
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual([
      PROFILE_URI,
      expect.stringContaining(`/${LOCATION}/`),
      ORGANIZATION_URI,
    ]);
    // Nothing was applied and the SDK did not retry.
    expect(creates).toEqual([]);
    expect(methods(requests).filter((method) => method === WRITE)).toHaveLength(1);
  });

  it("lists every record it tried to create when the outcome is unknown, and says calling again is safe", async () => {
    const { context } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createOrganization(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual([
      PROFILE_URI,
      expect.stringContaining(`/${LOCATION}/`),
      ORGANIZATION_URI,
    ]);
    expect(error.message).toMatch(
      /calling createOrganization again is safe: the call reads the organization first.*the organization already exists/,
    );
    // New locations have generated keys, so the message must not claim every record has a fixed key.
    expect(error.message).not.toMatch(/fixed key/);
  });

  it("counts the profile against the write limit only when the call creates it", async () => {
    const many = Array.from({ length: 199 }, (_, i) => location(`Office ${i}`));
    const created = fakeRepo({ existing: withProfile });

    await createOrganization(created.context, {
      organization: { additionalLocations: many },
    });
    expect(created.creates[0]).toHaveLength(200);

    const refused = fakeRepo();
    await expect(
      createOrganization(refused.context, {
        organization: { logo: png(), additionalLocations: many },
        profileIfMissing: { displayName: "Acme" },
      }),
    ).rejects.toThrow(/would write 201 records, but one write holds at most 200/);
    expect(methods(refused.requests)).toEqual([HEAD_METHOD, READ, READ]);
  });
});

describe("createOrganization input errors", () => {
  it.each<[string, unknown, RegExp]>([
    [
      "a misspelled organization field",
      { organization: { legalname: "Acme" } },
      /invalid organization: .*Allowed fields: legalName,/,
    ],
    [
      "an unknown top-level field",
      { organization: {}, profileIfmissing: {} },
      /invalid input: .*Allowed fields: organization, profileIfMissing/,
    ],
    [
      "a misspelled field in a URL",
      { organization: { urls: [{ url: "https://example.org", lable: "x" }] } },
      /Allowed fields: url, label/,
    ],
    [
      "an invalid fallback profile, although the account may have a profile",
      { organization: {}, profileIfMissing: { displayName: 5 } },
      /invalid profileIfMissing: /,
    ],
    [
      "an existing location given as a bare string",
      { organization: { location: uriOf(LOCATION) } },
      /organization\.location must be the fields of a new app\.certified\.location record, \{ uri \} of an existing one, but received a string/,
    ],
    [
      "an existing location of another record type",
      { organization: { additionalLocations: [{ uri: uriOf("org.hypercerts.claim.rights") }] } },
      /organization\.additionalLocations\[0\] points at a record of type org\.hypercerts\.claim\.rights, but this field holds app\.certified\.location/,
    ],
    [
      "{ uri } mixed with the fields of a new location",
      { organization: { location: { uri: uriOf(LOCATION), ...location("HQ") } } },
      /organization\.location combines `uri` with other fields/,
    ],
    [
      "a Leaflet document without its $type",
      { organization: { longDescription: { blocks: [] } } },
      /must be a string, \{ uri \} of an existing record, or a Leaflet document/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createOrganization(context, input as CreateOrganizationInput)).rejects.toThrow(
      message,
    );

    expect(requests).toHaveLength(0);
  });

  it("writes nothing for an organization the lexicon rejects", async () => {
    const { context, requests } = fakeRepo({ existing: withProfile });

    await expect(
      createOrganization(context, { organization: { langs: ["en", "es", "fr", "de"] } }),
    ).rejects.toThrow(
      /^createOrganization: organization is not a valid app\.certified\.actor\.organization record/,
    );

    expect(methods(requests)).not.toContain(WRITE);
  });
});
