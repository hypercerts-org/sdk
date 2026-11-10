import { type Cid, type l, parseCid, type UriString } from "@atproto/lex";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import { uploadBlob } from "../blob/upload-blob.js";
import type { BuildContext } from "./build-context.js";
import { describeError } from "./describe.js";

/**
 * Which blob wrapper a lexicon field uses: `smallImage` (images only, 5 MB), `largeImage` (images
 * only, 10 MB) or `smallBlob` (any file, 10 MB).
 */
export type BlobKind = "image" | "largeImage" | "blob";

/**
 * Turns a field that accepts a URL or a file into the lexicon value for it: a string becomes
 * `org.hypercerts.defs#uri` as it is, a `Blob` is uploaded and wrapped as `smallImage`,
 * `largeImage` or `smallBlob`.
 *
 * Internal. Boundaries:
 * - Never fetches a URL, and does not validate it here; the record's lexicon does.
 * - Checks a blob's type and size against the lexicon's limits before uploading, so a file the
 *   record would reject is never uploaded.
 *
 * Throws TypeError for a file the lexicon does not allow, and Error when the upload fails.
 */
export async function mediaValue<TKind extends BlobKind>(
  build: BuildContext,
  field: string,
  value: Blob | string,
  kind: TKind,
): Promise<l.$Typed<defs.Uri> | l.$Typed<StoredBlob[TKind]>> {
  if (typeof value === "string") return defs.uri.build({ uri: value as UriString });
  assertWithinLimits(build, field, value, kind);
  const blob = await uploadField(build, field, value);
  const { schema, property } = WRAPPERS[kind];
  return { $type: schema.$type, [property]: blob } as unknown as l.$Typed<StoredBlob[TKind]>;
}

// The lexicon object a blob is stored in, by kind.
type StoredBlob = { image: defs.SmallImage; largeImage: defs.LargeImage; blob: defs.SmallBlob };

// What each kind stores a blob reference in: the lexicon's wrapper object, the property of it that
// holds the reference, and what error messages call it.
const WRAPPERS = {
  image: { schema: defs.smallImage, property: "image", label: "small image" },
  largeImage: { schema: defs.largeImage, property: "image", label: "large image" },
  blob: { schema: defs.smallBlob, property: "blob", label: "blob" },
} as const;

/**
 * Uploads a file for a record field, wrapping a failure in an `Error` that names the operation and
 * the field (`could not upload <field>`) and keeps the original as `cause`.
 *
 * Internal. For fields that do not go through `mediaValue`, for example a blob stored directly in
 * the record. Check the file against the lexicon first, see `assertFileAllowed`.
 */
export async function uploadField(
  build: BuildContext,
  field: string,
  file: Blob,
): Promise<Awaited<ReturnType<typeof uploadBlob>>> {
  try {
    return await uploadBlob(build.context, file);
  } catch (error) {
    throw new Error(`${build.operation}: could not upload ${field}: ${describeError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Checks a file against a lexicon's rules before it is uploaded, so a file the record would reject
 * is not left behind as an unreferenced upload.
 *
 * Internal. `validate` runs the lexicon's own schema on a blob reference built from the file's type
 * and size, with a well-formed CID standing in for the one the upload will return; that reference
 * must never be put in a record. `purpose` finishes the sentence "<field> cannot be ..." in the
 * error. A Blob with no type is left to `uploadBlob`, which explains how to supply one.
 *
 * Throws TypeError when `validate` fails.
 */
export function assertFileAllowed(
  build: BuildContext,
  field: string,
  file: Blob,
  purpose: string,
  validate: (ref: PlaceholderBlobRef) => l.ValidationResult<unknown>,
): void {
  if (file.type === "") return;
  const ref: PlaceholderBlobRef = {
    $type: "blob",
    ref: parseCid("bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq", { flavor: "raw" }),
    mimeType: file.type,
    size: file.size,
  };
  const result = validate(ref);
  if (!result.success) {
    throw new TypeError(
      `${build.operation}: ${field} cannot be ${purpose} (${file.type}, ${file.size} bytes): ${result.message}. Nothing was uploaded.`,
      { cause: result },
    );
  }
}

type PlaceholderBlobRef = { $type: "blob"; ref: Cid; mimeType: string; size: number };

// The check runs the lexicon's own blob schema on the wrapper object for this kind.
function assertWithinLimits(build: BuildContext, field: string, file: Blob, kind: BlobKind): void {
  const { schema, property, label } = WRAPPERS[kind];
  assertFileAllowed(build, field, file, `stored as a ${label}`, (ref) =>
    schema.safeValidate({ [property]: ref }),
  );
}

/** A field transform for `recordKind` that uploads a `Blob` or keeps a URL string, see `mediaValue`. */
export const mediaTransform =
  (kind: BlobKind) => (build: BuildContext, field: string, value: Blob | string) =>
    mediaValue(build, field, value, kind);
