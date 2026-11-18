import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProfile } from "../src/actor/index.js";
import {
  createOrganization,
  OrganizationAlreadyExistsError,
  RecordAlreadyExistsError,
  WriteRejectedError,
} from "../src/organization/index.js";
import { coordinates, PNG, png, unique } from "./fixtures.js";
import {
  blobIn,
  collections,
  countRecords,
  defined,
  expectBlobServed,
  expectMissing,
  expectStored,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

// An account has one organization and one profile, both at the key `self`, so ones left by an
// earlier test or run would be in the way. Deleting is plain setup here, not something the SDK does.
beforeEach(async () => {
  await user.client.deleteRecord(collections.organization, "self");
  await user.client.deleteRecord(collections.profile, "self");
});

const selfUri = (collection: string) => `at://${user.did}/${collection}/self`;

describe("createOrganization", () => {
  it("creates the profile, a new location and the organization in one write, with the CIDs the PDS reports", async () => {
    const legalName = unique("Phobjikha Conservation Society");
    const displayName = unique("Phobjikha");
    const locations = await countRecords(user.client, collections.location);

    const result = await createOrganization(user.context, {
      organization: {
        legalName,
        organizationType: ["ngo"],
        urls: [{ url: "https://example.org/donate", label: "Donate" }],
        logo: png(),
        location: coordinates,
        longDescription: "We plant native trees.",
      },
      profileIfMissing: { displayName, description: "Planting trees." },
    });

    expect(result.organization.uri).toBe(selfUri(collections.organization));
    expect(result.profile).toMatchObject({ uri: selfUri(collections.profile), created: true });
    expect(result.location).toMatchObject({ created: true });
    expect(await countRecords(user.client, collections.location)).toBe(locations + 1);

    const stored = await expectStored(user.client, result.organization);
    expect(stored).toMatchObject({
      legalName,
      organizationType: ["ngo"],
      urls: [{ url: "https://example.org/donate", label: "Donate" }],
      location: { uri: result.location?.uri, cid: result.location?.cid },
    });
    await expectBlobServed(user.client, user.did, blobIn(stored.logo, "image"), PNG);
    expect(await expectStored(user.client, result.profile)).toMatchObject({ displayName });
    expect(await expectStored(user.client, defined(result.location))).toMatchObject({
      location: { string: "90.17,27.47" },
    });
  });

  it("reuses the profile the account has, unchanged, and an existing location by its URI", async () => {
    const profile = await createProfile(user.context, { displayName: unique("Existing") });
    const storedProfile = await expectStored(user.client, profile);
    // An earlier organization with a location, which this test then removes to create another.
    const earlier = await createOrganization(user.context, {
      organization: { location: coordinates },
    });
    const existingLocation = defined(earlier.location);
    await user.client.deleteRecord(collections.organization, "self");

    const result = await createOrganization(user.context, {
      organization: { legalName: unique("Reuse"), location: { uri: existingLocation.uri } },
      profileIfMissing: { displayName: "Ignored", avatar: png() },
    });

    expect(result.profile).toEqual({ ...profile, created: false });
    expect(result.location).toEqual({ ...existingLocation, created: false });
    expect(await expectStored(user.client, result.profile)).toEqual(storedProfile);
    expect(await expectStored(user.client, result.organization)).toMatchObject({
      location: { uri: existingLocation.uri, cid: existingLocation.cid },
    });
  });

  it("refuses to overwrite: a second call throws OrganizationAlreadyExistsError and the first organization stays", async () => {
    const first = await createOrganization(user.context, {
      organization: { legalName: unique("First") },
      profileIfMissing: { displayName: "Profile" },
    });
    const locations = await countRecords(user.client, collections.location);

    const error = await createOrganization(user.context, {
      organization: { legalName: "Second", location: coordinates },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrganizationAlreadyExistsError);
    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({
      uri: first.organization.uri,
      attempted: [],
      status: 400,
      code: "InvalidSwap",
    });
    await expectStored(user.client, first.organization);
    expect(await countRecords(user.client, collections.location)).toBe(locations);
  });

  it("writes nothing when the account has no profile and the input has no profileIfMissing", async () => {
    const locations = await countRecords(user.client, collections.location);

    const error = await createOrganization(user.context, {
      organization: { legalName: unique("No profile"), location: coordinates },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    await expectMissing(user.client, selfUri(collections.organization));
    await expectMissing(user.client, selfUri(collections.profile));
    expect(await countRecords(user.client, collections.location)).toBe(locations);
  });
});
