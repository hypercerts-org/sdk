import { describe, expect, it } from "vitest";
import { CID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, HEAD, methods } from "../test-utils/fake-repo.js";
import { png } from "../test-utils/records.js";
import { createBuildContext } from "./build-context.js";
import { mediaValue } from "./media.js";

// Every upload gets a CID of its own, so that a second upload of one file cannot go unnoticed by
// comparing references.
function repoWithDistinctUploads() {
  const cids = [CID, HEAD];
  let uploads = 0;
  const repo = fakeRepo({
    uploadBlob: () =>
      json(200, {
        blob: { $type: "blob", ref: { $link: cids[uploads++] }, mimeType: "image/png", size: 3 },
      }),
  });
  return { ...repo, uploadCount: () => uploads };
}

describe("mediaValue", () => {
  it("uploads a Blob object once per call, whatever fields and kinds use it, and gives each field the same blob reference", async () => {
    const { context, uploadCount } = repoWithDistinctUploads();
    const build = createBuildContext(context, "createTest");
    const file = png();

    const [small, large] = await Promise.all([
      mediaValue(build, "a", file, "image"),
      mediaValue(build, "b", file, "largeImage"),
    ]);

    expect(uploadCount()).toBe(1);
    expect(small).toMatchObject({ $type: "org.hypercerts.defs#smallImage" });
    expect(large).toMatchObject({ $type: "org.hypercerts.defs#largeImage" });
    expect((small as { image: unknown }).image).toBe((large as { image: unknown }).image);
  });

  it("uploads again for another Blob object with the same bytes, and for another call", async () => {
    const { context, requests } = fakeRepo();
    const uploads = () => methods(requests).filter((method) => method.endsWith("uploadBlob"));
    const file = png();

    await mediaValue(createBuildContext(context, "createTest"), "a", file, "image");
    await mediaValue(createBuildContext(context, "createTest"), "a", file, "image");
    expect(uploads()).toHaveLength(2);

    const build = createBuildContext(context, "createTest");
    await mediaValue(build, "a", png(), "image");
    await mediaValue(build, "b", png(), "image");
    expect(uploads()).toHaveLength(4);
  });

  it("checks the lexicon's limits for every field before sharing an upload", async () => {
    const { context, requests } = fakeRepo();
    const build = createBuildContext(context, "createTest");
    // Within a large image's 10 MiB, over a small image's 5 MiB.
    const file = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });

    await mediaValue(build, "banner", file, "largeImage");
    await expect(mediaValue(build, "image", file, "image")).rejects.toThrow(
      /^createTest: image cannot be stored as a small image/,
    );

    expect(methods(requests).filter((method) => method.endsWith("uploadBlob"))).toHaveLength(1);
  });

  it("reports a failed upload once, under the field that asked first, to every field that shares it", async () => {
    const { context, requests } = fakeRepo({
      uploadBlob: () => json(500, { error: "InternalServerError" }),
    });
    const build = createBuildContext(context, "createTest");
    const file = png();

    const results = await Promise.allSettled([
      mediaValue(build, "first", file, "image"),
      mediaValue(build, "second", file, "largeImage"),
    ]);

    expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
    for (const result of results) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        message: expect.stringMatching(/^createTest: could not upload first:/),
      });
    }
    expect(methods(requests).filter((method) => method.endsWith("uploadBlob"))).toHaveLength(1);
  });

  it("does not repeat the uploadBlob prefix in a failed upload's message", async () => {
    const { context } = fakeRepo({ uploadBlob: () => json(500, { error: "InternalServerError" }) });
    const build = createBuildContext(context, "createTest");

    const error = await mediaValue(build, "logo", png(), "image").catch((e) => e);

    expect(error.message).toMatch(/^createTest: could not upload logo: the upload failed \(/);
    expect(error.message).not.toContain("uploadBlob:");
  });
});
