import { isTypedBlobRef, type TypedBlobRef } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError, describeValue } from "../internal/describe.js";
import { isBlob } from "../internal/input.js";

/**
 * Binary content that {@link uploadBlob} accepts: a `Blob` or `File` in browsers and Node, a
 * `Uint8Array` (Node's `Buffer` is one) or an `ArrayBuffer`.
 *
 * @remarks
 * Strings are not accepted, so a file path or URL cannot be uploaded as its own text by mistake.
 * Streams are not accepted either: read them into a `Blob` or `Uint8Array` first.
 */
export type BlobData = Blob | Uint8Array | ArrayBuffer;

/** Options for {@link uploadBlob}. */
export interface UploadBlobOptions {
  /**
   * The content's MIME type, for example `image/png`.
   *
   * @remarks
   * Required for a `Uint8Array` or `ArrayBuffer`. A `Blob` or `File` uses its own `type` when this
   * is omitted.
   */
  mimeType?: string | undefined;
}

/**
 * Uploads binary content to the authenticated account's PDS and returns the blob reference that
 * records embed, for example as an image or attachment.
 *
 * @remarks
 * The upload goes through the context's client; the SDK opens no connection of its own.
 *
 * The blob is not part of any record yet. A PDS deletes blobs that no record references within a
 * short time window, so write the record that uses the reference soon after uploading. If that
 * write fails, the uploaded blob is simply left unused; nothing is rolled back.
 *
 * The SDK does not fetch external URLs (a URL in a record stays a URL), read file paths, resize or
 * convert content, or check MIME type and size limits. The PDS enforces its limits when it
 * receives the upload, and record-level limits are checked when the record referencing the blob is
 * written.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param data - The content to upload. See {@link BlobData}.
 * @param options - The content's MIME type. See {@link UploadBlobOptions}.
 * @returns The {@link TypedBlobRef} for the uploaded content: its CID (`ref`), `mimeType` and `size`.
 * @throws {@link TypeError} If `data` is not a `Blob`, `Uint8Array` or `ArrayBuffer`, or if no MIME
 * type is given or derivable, or it is not of the form `type/subtype`.
 * @throws {@link Error} If the upload fails, for example because the client is not authenticated,
 * the network is down or the PDS rejects the content, or if the PDS returns no usable blob
 * reference. The message includes the error code and message from the client, and `cause` holds
 * the client's original error.
 *
 * @example Uploading a file chosen in the browser
 * ```ts
 * import { uploadBlob } from "@hypercerts-org/sdk/blob";
 *
 * // `context` comes from createSDKContext; `file` from an <input type="file">.
 * const image = await uploadBlob(context, file);
 * ```
 *
 * @example Uploading bytes in Node
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { uploadBlob } from "@hypercerts-org/sdk/blob";
 *
 * const bytes = await readFile("report.pdf");
 * const report = await uploadBlob(context, bytes, { mimeType: "application/pdf" });
 * ```
 *
 * @example Bytes without a MIME type throw
 * ```ts
 * await uploadBlob(context, bytes); // TypeError: pass `{ mimeType }`
 * ```
 */
export async function uploadBlob(
  context: SDKContext,
  data: BlobData,
  options: UploadBlobOptions = {},
): Promise<TypedBlobRef> {
  const mimeType = resolveMimeType(data, options.mimeType);
  let blob: unknown;
  try {
    ({ blob } = (await context.client.uploadBlob(asBody(data), { encoding: mimeType })).body);
  } catch (error) {
    throw new Error(`uploadBlob: the upload failed (${describeError(error)}).`, { cause: error });
  }
  // With default client options the response is schema-checked, so this only catches clients
  // configured to skip validation: a missing blob, or the legacy `{ cid, mimeType }` format, which
  // has no size and cannot be embedded in current records. Non-strict checking (which allows any
  // CID, as such clients do) treats `size: -1` as "unknown", so that is rejected explicitly.
  if (!isTypedBlobRef(blob, { strict: false }) || blob.size < 0) {
    throw new Error(
      'uploadBlob: the PDS did not return a current blob reference (`$type: "blob"` with a size).',
    );
  }
  return blob;
}

// Type and subtype follow `restricted-name` from RFC 6838 §4.2: a letter or digit, then up to 126
// of `A-Z a-z 0-9 ! # $ & - ^ _ . +`. Parameters (RFC 9110 §8.3.1) are only limited to printable
// ASCII, because the value is sent as an HTTP header and the PDS does its own parsing.
const MIME_TYPE =
  /^[A-Za-z0-9][\w!#$&^.+-]{0,126}\/[A-Za-z0-9][\w!#$&^.+-]{0,126}(?:[ \t]*;[\x20-\x7e]*)?$/;

function resolveMimeType(data: BlobData, mimeType: string | undefined): `${string}/${string}` {
  // Checked by tag, not `instanceof`, so values from another realm (an iframe, jsdom, a polyfill)
  // are accepted. Node's Buffer is tagged Uint8Array. See `asBody` for ArrayBuffers.
  const tag = Object.prototype.toString.call(data);
  const blobData = isBlob(data);
  if (!blobData && tag !== "[object Uint8Array]" && tag !== "[object ArrayBuffer]") {
    throw new TypeError(
      `uploadBlob: \`data\` must be a Blob, File, Uint8Array or ArrayBuffer, but received ${describeValue(data)}. ` +
        "The SDK does not read file paths, fetch URLs or accept streams: read the content into a Blob or Uint8Array first.",
    );
  }
  // A Blob whose type the platform could not determine has `type === ""`.
  const type = mimeType ?? (blobData && data.type !== "" ? data.type : undefined);
  if (type === undefined) {
    throw new TypeError(
      'uploadBlob: the content\'s MIME type is unknown. Pass it as `{ mimeType }`, for example `{ mimeType: "image/png" }`.',
    );
  }
  if (!MIME_TYPE.test(type)) {
    throw new TypeError(
      `uploadBlob: \`mimeType\` must look like \`type/subtype\` (for example \`image/png\`), but received ${JSON.stringify(type)}.`,
    );
  }
  return type as `${string}/${string}`;
}

// The client checks ArrayBuffers with `instanceof`, which fails for one from another realm. A
// Uint8Array view over it passes the client's realm-independent check and copies nothing.
function asBody(data: BlobData): BlobData {
  return Object.prototype.toString.call(data) === "[object ArrayBuffer]"
    ? new Uint8Array(data as ArrayBuffer)
    : data;
}
