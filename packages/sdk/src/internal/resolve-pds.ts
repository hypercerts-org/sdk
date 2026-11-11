import type { DidString } from "@atproto/lex";
import {
  createDidResolver,
  DidCacheMemory,
  DidError,
  extractPdsUrl,
  isAtprotoDid,
} from "@atproto-labs/did-resolver";
import type { DidDocumentResolver, SDKContext } from "../context.js";
import { describeError } from "./describe.js";

/**
 * The resolver a context uses when the application does not supply one: `did:plc` from
 * plc.directory and `did:web` from the domain, with its own in-memory cache and one shared lookup
 * for concurrent requests for the same DID.
 *
 * Internal. Each context gets its own, so documents are shared by the calls of one context only.
 */
export function createDefaultDidResolver(): DidDocumentResolver {
  return createDidResolver({
    didCache: new DidCacheMemory(),
    // Looked up when the request is made, not now, so replacing the global `fetch` after the
    // context exists (a test stub, for example) still takes effect.
    fetch: (input, init) => globalThis.fetch(input, init),
  });
}

/**
 * Finds the PDS that hosts `did`'s repository from its DID document.
 *
 * Internal. Supports `did:plc` and `did:web`, the methods atproto allows, and asks
 * `context.didResolver` for the document, so repeated lookups are as cached as that resolver is.
 *
 * Throws Error when the DID method is not supported, the document cannot be fetched or is
 * invalid, or it lists no atproto PDS.
 */
export async function resolvePds(context: SDKContext, did: DidString): Promise<URL> {
  if (!isAtprotoDid(did)) {
    throw new Error(`cannot resolve the PDS of ${did}: only did:plc and did:web are supported.`);
  }
  try {
    // An IdentityResolver (oauthClient.identityResolver) wraps the document; a DidResolver
    // returns it as is.
    const resolved = await context.didResolver.resolve(did);
    return extractPdsUrl("didDoc" in resolved ? resolved.didDoc : resolved);
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
