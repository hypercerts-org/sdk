import {
  type AtUriString,
  type CidString,
  Client,
  type DidString,
  isDidString,
  isNsidString,
  isRecordKeyString,
  l,
} from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError, isRecordNotFound } from "./describe.js";
import { resolvePds } from "./resolve-pds.js";

// TODO(TECH-752 follow-up): once @hypercerts-org/lexicon publishes the `/records` subpath
// (TECH-750), replace this with its `com.atproto.repo.strongRef` type so the SDK does not define
// its own copy of the shape.
/** A pinned reference to one version of a record: its URI and the CID of that version. */
export interface StrongRef {
  uri: AtUriString;
  cid: CidString;
}

const atUri = l.string({ format: "at-uri" });
const cidString = l.string({ format: "cid" });

/**
 * Reads the record at `uri` and returns its URI and current CID, for a record that references it.
 *
 * Internal: creation operations call this; it is not part of the public API.
 *
 * Boundaries:
 * - Reads with `com.atproto.repo.getRecord` from the PDS that hosts the record, the authoritative
 *   copy. A record in the client's own repo is read through `context.client`. For another
 *   account's record the owner's PDS is found from their DID document (plc.directory for
 *   `did:plc`, `/.well-known/did.json` for `did:web`) and read without authentication, so only
 *   public records resolve. The client's PDS is not used for those reads because it would forward
 *   them to its AppView, which may not index the record or may return an outdated CID.
 * - Never falls back to an indexer: a failed read throws.
 * - Does not check the record's type or whether the caller may reference it. That is the calling
 *   operation's decision, and it imposes no same-owner restriction.
 *
 * Throws TypeError for a URI that is not `at://<did>/<collection>/<rkey>` (handle authorities are
 * rejected because a stored reference must not change when the handle does), and Error when the
 * owner's PDS cannot be resolved, the record does not exist, the read fails, or the PDS returns
 * no CID.
 */
export async function resolveRecordRef(context: SDKContext, uri: string): Promise<StrongRef> {
  const { atUri: requested, did, collection, rkey } = parseRecordUri(uri);
  let response: Awaited<ReturnType<Client["getRecord"]>>;
  try {
    const client = await clientForRepo(context, did);
    response = await client.getRecord(collection, rkey, { repo: did });
  } catch (error) {
    const reason = isRecordNotFound(error)
      ? "the record was not found"
      : `the read failed (${describeError(error)})`;
    throw new Error(`resolveRecordRef: cannot resolve ${uri}: ${reason}.`, { cause: error });
  }
  // Checked here as well as by the client, because an application can turn off the client's
  // response validation and an unchecked reference would be written into a record.
  const { cid, uri: returnedUri } = response.body as { cid?: unknown; uri?: unknown };
  if (!cidString.matches(cid)) {
    throw new Error(
      `resolveRecordRef: cannot resolve ${uri}: the PDS returned the record without a valid CID.`,
    );
  }
  if (returnedUri !== requested) {
    throw new Error(
      `resolveRecordRef: cannot resolve ${uri}: the PDS returned a different record (${String(returnedUri)}).`,
    );
  }
  return { uri: requested, cid };
}

async function clientForRepo(context: SDKContext, did: DidString): Promise<Client> {
  if (context.client.did === did) return context.client;
  return new Client(await resolvePds(did));
}

function parseRecordUri(uri: string) {
  // `at-uri` alone also accepts handle authorities and URIs without a collection or record key.
  if (!atUri.matches(uri)) throw notARecordUri(uri);
  const [did, collection, rkey, ...rest] = uri.slice("at://".length).split("/");
  if (
    rest.length === 0 &&
    did !== undefined &&
    isDidString(did) &&
    collection !== undefined &&
    isNsidString(collection) &&
    rkey !== undefined &&
    isRecordKeyString(rkey)
  ) {
    return { atUri: uri, did, collection, rkey };
  }
  throw notARecordUri(uri);
}

function notARecordUri(uri: string): TypeError {
  return new TypeError(
    `resolveRecordRef: ${JSON.stringify(uri)} is not a record URI. Expected at://<did>/<collection>/<rkey>, for example at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8. Handles are not accepted as the authority.`,
  );
}
