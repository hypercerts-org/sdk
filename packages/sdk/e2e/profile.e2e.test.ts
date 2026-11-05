import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createProfile,
  ProfileAlreadyExistsError,
  WriteRejectedError,
} from "../src/actor/index.js";
import { PNG, png, unique } from "./fixtures.js";
import { blobIn, collections, defined, expectBlobServed, expectStored } from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

// An account has one profile, at the key `self`, so a profile left by an earlier test or run would
// make every later `createProfile` fail. Deleting is plain setup here, not something the SDK does.
beforeEach(async () => {
  await user.client.deleteRecord(collections.profile, "self");
});

describe("createProfile", () => {
  it("stores the profile at `self` with the CID the PDS reports", async () => {
    const input = {
      displayName: unique("Alice"),
      description: "Planting trees.",
      langs: ["en"],
      website: "https://example.org",
    };

    const ref = await createProfile(user.context, {
      ...input,
      banner: "https://example.org/banner.png",
    });

    expect(ref.uri).toBe(`at://${user.did}/${collections.profile}/self`);
    expect(await expectStored(user.client, ref)).toMatchObject({
      ...input,
      banner: { $type: "org.hypercerts.defs#uri", uri: "https://example.org/banner.png" },
    });
  });

  it("stores Blob images as blobs the PDS serves", async () => {
    const ref = await createProfile(user.context, { avatar: png(), banner: png() });

    const stored = await expectStored(user.client, ref);
    expect(stored.avatar).toMatchObject({ $type: "org.hypercerts.defs#smallImage" });
    expect(stored.banner).toMatchObject({ $type: "org.hypercerts.defs#largeImage" });
    await expectBlobServed(user.client, user.did, blobIn(stored.avatar, "image"), PNG);
    await expectBlobServed(user.client, user.did, blobIn(stored.banner, "image"), PNG);
  });

  it("refuses to overwrite: a second call throws ProfileAlreadyExistsError and the first profile stays", async () => {
    const first = await createProfile(user.context, { displayName: unique("First") });

    const error = await createProfile(user.context, { displayName: "Second" }).catch((e) => e);

    expect(error).toBeInstanceOf(ProfileAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    await expectStored(user.client, first);
  });

  it("lets exactly one of two simultaneous calls create the profile", async () => {
    const results = await Promise.allSettled([
      createProfile(user.context, { displayName: unique("One") }),
      createProfile(user.context, { displayName: unique("Two") }),
    ]);

    const created = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBeInstanceOf(ProfileAlreadyExistsError);
    await expectStored(user.client, defined(created[0]).value);
  });
});
