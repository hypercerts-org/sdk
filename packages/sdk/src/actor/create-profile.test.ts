import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo } from "../test-utils/fake-repo.js";
import {
  createProfile,
  ProfileAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const PROFILE = "app.certified.actor.profile";
const SELF_URI = `at://${DID}/${PROFILE}/self`;
const image = (type: string, size = 3) => new Blob([new Uint8Array(size)], { type });
const MiB = 1024 * 1024;

describe("createProfile", () => {
  it("creates the profile at `self` with putRecord, only if absent, uploading a Blob and keeping a URL", async () => {
    const { context, requests, puts } = fakeRepo();

    const ref = await createProfile(context, {
      displayName: "Alice",
      langs: ["en", "pt-BR"],
      avatar: image("image/png"),
      banner: "https://example.org/banner.png",
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.putRecord",
    ]);
    const [put] = puts;
    expect(put).toMatchObject({ collection: PROFILE, rkey: "self", swapRecord: null });
    expect(put?.value).toMatchObject({
      $type: PROFILE,
      displayName: "Alice",
      langs: ["en", "pt-BR"],
      avatar: {
        $type: "org.hypercerts.defs#smallImage",
        image: { mimeType: "image/png", size: 3 },
      },
      banner: { $type: "org.hypercerts.defs#uri", uri: "https://example.org/banner.png" },
    });
    expect(typeof put?.value.createdAt).toBe("string");
    expect(ref).toEqual({ uri: SELF_URI, cid: put && refTo(put).cid });
  });

  it("gives the banner a 10 MB limit and the avatar 5 MB, before uploading anything", async () => {
    const { context, requests, puts } = fakeRepo();

    await expect(createProfile(context, { avatar: image("image/png", 6 * MiB) })).rejects.toThrow(
      /avatar cannot be stored as a small image/,
    );
    expect(requests).toHaveLength(0);

    await createProfile(context, { banner: image("image/webp", 6 * MiB) });
    expect(puts[0]?.value.banner).toMatchObject({
      $type: "org.hypercerts.defs#largeImage",
      image: { mimeType: "image/webp", size: 6 * MiB },
    });
  });

  it("throws ProfileAlreadyExistsError when the account has a profile, carrying what the PDS said", async () => {
    const { context, puts } = fakeRepo({ existing: { [SELF_URI]: CID } });

    const error = await createProfile(context, { displayName: "Alice" }).catch((e) => e);

    expect(error).toBeInstanceOf(ProfileAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidSwap" });
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual([SELF_URI]);
    expect(error.message).toContain("never overwrites");
    expect(puts).toHaveLength(0);
  });

  it.each([
    [
      "a 4xx with another code",
      json(400, { error: "InvalidRequest", message: "no" }),
      WriteRejectedError,
      /rejected the request \(HTTP 400/,
    ],
    [
      "a server error",
      json(500, { error: "InternalServerError", message: "boom" }),
      WriteOutcomeUnknownError,
      /calling createProfile again is safe.*already exists/,
    ],
  ])("keeps the usual classification for %s", async (_, response, expected, message) => {
    const { context } = fakeRepo({ putRecord: () => response });

    const error = await createProfile(context, { displayName: "Alice" }).catch((e) => e);

    expect(error).toBeInstanceOf(expected);
    expect(error).not.toBeInstanceOf(ProfileAlreadyExistsError);
    expect(error.message).toMatch(message);
  });

  it("sends nothing for a profile the lexicon rejects", async () => {
    const { context, requests } = fakeRepo();

    await expect(createProfile(context, { langs: ["en", "es", "fr", "de"] })).rejects.toThrow(
      /^createProfile: input is not a valid app\.certified\.actor\.profile record/,
    );

    expect(requests).toHaveLength(0);
  });
});
