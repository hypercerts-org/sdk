import type { DidString } from "@atproto/lex";
import { describeError } from "./describe.js";

const PLC_DIRECTORY = "https://plc.directory";

/**
 * Finds the PDS that hosts `did`'s repository from its DID document.
 *
 * Internal. Supports `did:plc` (read from plc.directory) and host-only `did:web`, the two
 * methods atproto allows. Uses the global `fetch` and does not cache.
 *
 * Throws Error when the document cannot be fetched, belongs to another DID, or lists no
 * `#atproto_pds` service with an http(s) endpoint.
 */
export async function resolvePds(did: DidString): Promise<URL> {
  const document = await fetchDidDocument(did);
  if (!isRecord(document) || document.id !== did) {
    throw new Error(`cannot resolve the PDS of ${did}: its DID document is invalid.`);
  }
  const endpoint = findPdsEndpoint(did, document.service);
  if (endpoint === undefined) {
    throw new Error(`cannot resolve the PDS of ${did}: its DID document lists no atproto PDS.`);
  }
  return endpoint;
}

function didDocumentUrl(did: DidString): string {
  if (did.startsWith("did:plc:")) return `${PLC_DIRECTORY}/${did}`;
  if (did.startsWith("did:web:")) {
    const host = decodeURIComponent(did.slice("did:web:".length));
    // A further ":" would be a path, which atproto does not allow for did:web.
    if (!host.includes(":") || /^[^:]+:\d+$/.test(host)) {
      return `https://${host}/.well-known/did.json`;
    }
  }
  throw new Error(
    `cannot resolve the PDS of ${did}: only did:plc and host-only did:web are supported.`,
  );
}

async function fetchDidDocument(did: DidString): Promise<unknown> {
  const url = didDocumentUrl(did);
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new Error(
      `cannot resolve the PDS of ${did}: fetching ${url} failed (${describeError(error)}).`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `cannot resolve the PDS of ${did}: ${url} responded with HTTP ${response.status}.`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`cannot resolve the PDS of ${did}: ${url} did not return JSON.`, {
      cause: error,
    });
  }
}

function findPdsEndpoint(did: DidString, services: unknown): URL | undefined {
  if (!Array.isArray(services)) return undefined;
  for (const service of services) {
    if (!isRecord(service)) continue;
    const isPds =
      (service.id === "#atproto_pds" || service.id === `${did}#atproto_pds`) &&
      service.type === "AtprotoPersonalDataServer";
    if (!isPds || typeof service.serviceEndpoint !== "string") continue;
    const url = URL.parse(service.serviceEndpoint);
    if (url?.protocol === "https:" || url?.protocol === "http:") return url;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
