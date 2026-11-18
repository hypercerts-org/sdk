import type { DidString, TypedBlobRef } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { createBuildContext } from "../internal/build-context.js";

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
  /**
   * The DID of the repository to upload to. Default: the signed-in account's own repository.
   *
   * @remarks
   * An organization's DID uploads through the Certified Group Service, so that the organization's
   * PDS holds the blob; a blob on the member's own PDS would leave the organization's records
   * pointing at a blob their repository does not have. The context needs `cgs` for that (see
   * `WriteOptions`), and CGS enforces the member's role and its blob size limit.
   */
  repo?: DidString | undefined;
}

/**
 * Uploads binary content to the authenticated account's PDS and returns the blob reference that
 * records embed, for example as an image or attachment.
 *
 * @remarks
 * The upload goes through the context's client; the SDK opens no connection of its own. With `repo`
 * set to an organization's DID it goes to the Certified Group Service instead, with a service-auth
 * token the context's client obtains from the account's PDS.
 *
 * Uploads are not part of the atomic write. A blob is stored as soon as it is uploaded, before any
 * record refers to it, and a record write that fails afterwards does not undo it. The `create*`
 * operations upload the `Blob` and `File` values in their input before they write, so a call that
 * throws can leave blobs that no record references. A PDS usually deletes unreferenced blobs after
 * a while, but this is not guaranteed, and a blob with the same content that another record already
 * uses stays. After {@link WriteOutcomeUnknownError} or {@link WriteResultMismatchError} the records
 * may exist (after a mismatch they do), so the blobs may be referenced and publicly readable: check
 * the attempted records before relying on cleanup.
 *
 * The blob is not part of any record yet when you call this function yourself, and a PDS may delete
 * blobs that no record references after a short time. Write the record that uses the reference
 * soon after uploading.
 *
 * The SDK does not fetch external URLs (a URL in a record stays a URL), read file paths, resize or
 * convert content, or check MIME type and size limits. The PDS enforces its limits when it
 * receives the upload, and record-level limits are checked when the record referencing the blob is
 * written.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param data - The content to upload. See {@link BlobData}.
 * @param options - The content's MIME type, and optionally `repo`, the DID of an organization to upload
 * to through the Certified Group Service. See {@link UploadBlobOptions}.
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
  const { target } = createBuildContext(context, "uploadBlob", { repo: options?.repo });
  return target.uploadBlob(data, options?.mimeType);
}
