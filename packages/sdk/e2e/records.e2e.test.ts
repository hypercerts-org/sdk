import { beforeAll, describe, expect, it } from "vitest";
import {
  createContribution,
  createContributorInformation,
  createRights,
} from "../src/activity/index.js";
import { createLocation } from "../src/location/index.js";
import { coordinates, PNG, png, rights, unique } from "./fixtures.js";
import { blobIn, collections, expectBlobServed, expectStored } from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

describe("the standalone creators", () => {
  it("createRights stores the record and returns the CID the PDS reports", async () => {
    const ref = await createRights(user.context, rights);

    const stored = await expectStored(user.client, ref);
    expect(ref.uri).toMatch(new RegExp(`^at://${user.did}/${collections.rights}/`));
    expect(stored).toMatchObject(rights);
  });

  it("createContributorInformation stores the record and returns the CID the PDS reports", async () => {
    const input = { identifier: "did:plc:alice123", displayName: unique("Alice") };

    const ref = await createContributorInformation(user.context, input);

    expect(await expectStored(user.client, ref)).toMatchObject(input);
  });

  it("createContribution stores the record and returns the CID the PDS reports", async () => {
    const input = { role: "Lead", startDate: "2024-01-01T00:00:00Z" };

    const ref = await createContribution(user.context, input);

    expect(await expectStored(user.client, ref)).toMatchObject(input);
  });

  it("stores a Blob attachment of a rights record as a blob the PDS serves", async () => {
    const bytes = new TextEncoder().encode(unique("terms"));
    const attachment = new File([bytes], "terms.txt", { type: "text/plain" });

    const ref = await createRights(user.context, { ...rights, attachment });

    const stored = await expectStored(user.client, ref);
    expect(stored.attachment).toMatchObject({ $type: "org.hypercerts.defs#smallBlob" });
    await expectBlobServed(user.client, user.did, blobIn(stored.attachment, "blob"), bytes);
  });

  it("stores a Blob image of a contributor as a blob the PDS serves", async () => {
    const ref = await createContributorInformation(user.context, {
      displayName: unique("Bob"),
      image: png(),
    });

    const stored = await expectStored(user.client, ref);
    expect(stored.image).toMatchObject({ $type: "org.hypercerts.defs#smallImage" });
    await expectBlobServed(user.client, user.did, blobIn(stored.image, "image"), PNG);
  });

  it("createLocation stores the record and returns the CID the PDS reports", async () => {
    const input = { ...coordinates, name: unique("Valley") };

    const ref = await createLocation(user.context, input);

    const stored = await expectStored(user.client, ref);
    expect(stored).toMatchObject({
      ...input,
      location: { $type: "app.certified.location#string", string: "27.47,90.17" },
    });
  });

  it("stores a Blob location as a blob the PDS serves", async () => {
    const bytes = new TextEncoder().encode(unique('{"type":"Point","coordinates":[90.17,27.47]}'));
    const blob = new File([bytes], "point.geojson", { type: "application/geo+json" });

    const ref = await createLocation(user.context, {
      ...coordinates,
      locationType: "geojson-point",
      location: { blob },
    });

    const stored = await expectStored(user.client, ref);
    expect(stored.location).toMatchObject({ $type: "org.hypercerts.defs#smallBlob" });
    await expectBlobServed(user.client, user.did, blobIn(stored.location, "blob"), bytes);
  });
});
