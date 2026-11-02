import type { DidString } from "@atproto/lex";
import {
  DidError,
  DidResolverCommon,
  extractPdsUrl,
  isAtprotoDid,
} from "@atproto-labs/did-resolver";
import { describeError } from "./describe.js";

/**
 * Finds the PDS that hosts `did`'s repository from its DID document.
 *
 * Internal. Supports `did:plc` (read from plc.directory) and `did:web`, the methods atproto
 * allows. Uses the global `fetch` and does not cache.
 *
 * Throws Error when the DID method is not supported, the document cannot be fetched or is
 * invalid, or it lists no atproto PDS.
 */
export async function resolvePds(did: DidString): Promise<URL> {
  if (!isAtprotoDid(did)) {
    throw new Error(`cannot resolve the PDS of ${did}: only did:plc and did:web are supported.`);
  }
  try {
    // Created per call so the global `fetch` is looked up when the request is made.
    const document = await new DidResolverCommon().resolve(did);
    return extractPdsUrl(document);
  } catch (error) {
    throw new Error(`cannot resolve the PDS of ${did}: ${describeDidError(error)}.`, {
      cause: error,
    });
  }
}

// The resolver's errors for an HTTP failure have an empty message and carry the reason in `code`
// and `status` (for example "did-fetch-error", 404).
function describeDidError(error: unknown): string {
  const message = describeError(error);
  if (message !== "" || !(error instanceof DidError)) return message;
  return `${error.code} (HTTP ${error.status})`;
}
