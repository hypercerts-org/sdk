import { describe, expect, it } from "vitest";
import { CID, fakePds, json } from "../test-utils/fake-pds.js";
import { uploadBlob } from "./index.js";

const bytes = new TextEncoder().encode("hello");

function uploaded(mimeType: string) {
  return json(200, { blob: { $type: "blob", ref: { $link: CID }, mimeType, size: 5 } });
}

describe("uploadBlob", () => {
  it.each([
    ["a Uint8Array", bytes, { mimeType: "text/plain" }],
    ["an ArrayBuffer", bytes.slice().buffer, { mimeType: "text/plain" }],
    ["a Blob, using its own type", new Blob([bytes], { type: "text/plain" }), {}],
  ] as const)("uploads %s and returns the PDS's blob reference", async (_, data, options) => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));

    const ref = await uploadBlob(context, data, options);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/xrpc/com.atproto.repo.uploadBlob");
    expect(requests[0]?.headers.get("content-type")).toBe("text/plain");
    expect(requests[0]?.body).toEqual(bytes);
    expect(ref.mimeType).toBe("text/plain");
    expect(ref.size).toBe(5);
    expect(ref.ref.toString()).toBe(CID);
  });

  // A view's underlying buffer holds more than the view (Node's Buffer slices work the same way);
  // uploading `.buffer` would send the extra bytes.
  it("uploads only the bytes of a Uint8Array view with an offset", async () => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));
    const view = new TextEncoder().encode("xxhelloxx").subarray(2, 7);

    await uploadBlob(context, view, { mimeType: "text/plain" });

    expect(requests[0]?.body).toEqual(bytes);
  });

  it("accepts a MIME type with parameters", async () => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));

    await uploadBlob(context, bytes, { mimeType: "text/plain; charset=utf-8" });

    expect(requests[0]?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("accepts bytes from another realm, as the client does", async () => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));
    // Stands in for a Uint8Array created in an iframe or jsdom: same tag, different prototype.
    const foreign = Object.setPrototypeOf(new Uint8Array(bytes), {
      [Symbol.toStringTag]: "Uint8Array",
    });

    await uploadBlob(context, foreign, { mimeType: "text/plain" });

    expect(requests[0]?.body).toEqual(bytes);
  });

  it("accepts an ArrayBuffer from another realm", async () => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));
    const foreign = Object.setPrototypeOf(bytes.slice().buffer, {
      [Symbol.toStringTag]: "ArrayBuffer",
    });

    await uploadBlob(context, foreign, { mimeType: "text/plain" });

    expect(requests[0]?.body).toEqual(bytes);
  });

  it("prefers an explicit mimeType over the Blob's type", async () => {
    const { context, requests } = fakePds(() => uploaded("image/png"));

    await uploadBlob(context, new Blob([bytes], { type: "text/plain" }), { mimeType: "image/png" });

    expect(requests[0]?.headers.get("content-type")).toBe("image/png");
  });

  it.each([
    ["bytes without a mimeType", bytes, {}, /Pass it as `\{ mimeType \}`/],
    ["a Blob with no type", new Blob([bytes]), {}, /Pass it as `\{ mimeType \}`/],
    ["a malformed mimeType", bytes, { mimeType: "png" }, /must look like `type\/subtype`/],
    ["a mimeType starting with a symbol", bytes, { mimeType: "+image/png" }, /must look like/],
    [
      "a mimeType name over 127 characters",
      bytes,
      { mimeType: `image/${"a".repeat(128)}` },
      /must look like/,
    ],
    ["a line break in the mimeType", bytes, { mimeType: "image/png\r\n; x=1" }, /must look like/],
    ["a file path", "./report.pdf", { mimeType: "application/pdf" }, /does not read file paths/],
    [
      "a stream",
      new ReadableStream(),
      { mimeType: "text/plain" },
      /received an object of type ReadableStream/,
    ],
  ] as const)("rejects %s before sending anything", async (_, data, options, message) => {
    const { context, requests } = fakePds(() => uploaded("text/plain"));

    // @ts-expect-error The file-path and stream cases deliberately pass unsupported data.
    const upload = uploadBlob(context, data, options);

    await expect(upload).rejects.toThrow(TypeError);
    await expect(upload).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it("reports the PDS's error and keeps the original as cause", async () => {
    const { context } = fakePds(() =>
      json(400, { error: "BlobTooLarge", message: "Blob exceeds the 1MB limit" }),
    );

    const error = await uploadBlob(context, bytes, { mimeType: "text/plain" }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "uploadBlob: the upload failed (BlobTooLarge: Blob exceeds the 1MB limit).",
    );
    expect(error.cause).toMatchObject({ error: "BlobTooLarge" });
  });

  it("rejects a blob reference whose size is unknown from a client with lenient response processing", async () => {
    const { context } = fakePds(
      () =>
        json(200, {
          blob: { $type: "blob", ref: { $link: CID }, mimeType: "text/plain", size: -1 },
        }),
      { strictResponseProcessing: false },
    );

    await expect(uploadBlob(context, bytes, { mimeType: "text/plain" })).rejects.toThrow(
      /did not return a current blob reference/,
    );
  });

  it("rejects a response without a current blob reference from a client that skips validation", async () => {
    const { context } = fakePds(() => json(200, { blob: { cid: CID, mimeType: "text/plain" } }), {
      validateResponse: false,
    });

    await expect(uploadBlob(context, bytes, { mimeType: "text/plain" })).rejects.toThrow(
      /did not return a current blob reference/,
    );
  });
});
