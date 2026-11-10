import { type l, parseCid, type UriString } from "@atproto/lex";
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
  let blob: Awaited<ReturnType<typeof uploadBlob>>;
  try {
    blob = await uploadBlob(build.context, value);
  } catch (error) {
    throw new Error(`${build.operation}: could not upload ${field}: ${describeError(error)}`, {
      cause: error,
    });
  }
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

// The check runs the lexicon's own blob schema on a blob reference built from the file's type and
// size, with a well-formed CID standing in for the one the upload will return. A Blob with no type
// is left to `uploadBlob`, which explains how to supply one.
function assertWithinLimits(build: BuildContext, field: string, file: Blob, kind: BlobKind): void {
  if (file.type === "") return;
  const ref = {
    $type: "blob",
    ref: parseCid("bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq", { flavor: "raw" }),
    mimeType: file.type,
    size: file.size,
  };
  const { schema, property, label } = WRAPPERS[kind];
  const result = schema.safeValidate({ [property]: ref });
  if (!result.success) {
    throw new TypeError(
      `${build.operation}: ${field} cannot be stored as a ${label} (${file.type}, ${file.size} bytes): ${result.message}. Nothing was uploaded.`,
      { cause: result },
    );
  }
}

/** A field transform for `recordKind` that uploads a `Blob` or keeps a URL string, see `mediaValue`. */
export const mediaTransform =
  (kind: BlobKind) => (build: BuildContext, field: string, value: Blob | string) =>
    mediaValue(build, field, value, kind);
