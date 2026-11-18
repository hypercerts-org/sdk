import { isTypedBlobRef, type TypedBlobRef } from "@atproto/lex";
import type { BlobData } from "../blob/upload-blob.js";
import { describeError, describeValue } from "./describe.js";
import { isBlob } from "./input.js";

/**
 * Validates `data` and its MIME type, sends it with `send`, and checks the blob reference `send`
 * returns. Shared by the targets, which differ only in where `send` posts the bytes.
 *
 * `send` resolves to the `blob` member of the server's answer. `service` names who answers in error messages. Throws what `uploadBlob` documents.
 */
export async function uploadVia(
  send: (body: BlobData, encoding: `${string}/${string}`) => Promise<unknown>,
  data: BlobData,
  mimeType: string | undefined,
  service = "the PDS",
): Promise<TypedBlobRef> {
  const encoding = resolveMimeType(data, mimeType);
  let blob: unknown;
  try {
    blob = await send(asBody(data), encoding);
  } catch (error) {
    throw new Error(`uploadBlob: the upload failed (${describeError(error)}).`, { cause: error });
  }
  // With default client options the response is schema-checked, so this only catches clients
  // configured to skip validation: a missing blob, or the legacy `{ cid, mimeType }` format, which
  // has no size and cannot be embedded in current records. Non-strict checking (which allows any
  // CID, as such clients do) treats `size: -1` as "unknown", so that is rejected explicitly.
  if (!isTypedBlobRef(blob, { strict: false }) || blob.size < 0) {
    throw new Error(
      `uploadBlob: ${service} did not return a current blob reference (\`$type: "blob"\` with a size).`,
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
