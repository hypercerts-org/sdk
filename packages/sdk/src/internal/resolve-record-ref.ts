import {
  Client,
  type DidString,
  isDidString,
  isNsidString,
  isRecordKeyString,
  type LexMap,
  l,
  type NsidString,
  type RecordKeyString,
} from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import type { SDKContext } from "../context.js";
import { describeError, isRecordNotFound } from "./describe.js";
import { resolvePds } from "./resolve-pds.js";

/** A pinned reference to one version of a record: its URI and the CID of that version. */
export type StrongRef = strongRef.Main;

const atUri = l.string({ format: "at-uri" });

/** A record as its PDS stores it: the reference that pins this version, and the full value. */
export interface StoredRecord {
  readonly ref: StrongRef;
  readonly value: LexMap;
}

/**
 * Reads the record at `uri` and returns its URI and current CID, for a record that references it.
 *
 * Internal: creation operations call this; it is not part of the public API.
 *
 * Boundaries: the same as `readRecord`, which does the reading. This keeps only the reference.
 *
 * Throws what `readRecord` throws.
 */
export async function resolveRecordRef(
  context: SDKContext,
  uri: string,
  pdsClients?: PdsClients,
): Promise<StrongRef> {
  return (await readRecord(context, uri, "resolveRecordRef", pdsClients)).ref;
}

/**
 * Reads the record at `uri` and returns its reference and its full value, for an operation that
 * needs more than the CID (one that rewrites the record, for example).
 *
 * Internal: operations call this; it is not part of the public API. `operation` names the caller
 * in error messages.
 *
 * Boundaries:
 * - Reads with `com.atproto.repo.getRecord` from the PDS that hosts the record, the authoritative
 *   copy. A record in the client's own repo is read through `context.client`. For another
 *   account's record the owner's PDS is found from their DID document, through
 *   `context.didResolver` (by default plc.directory for `did:plc` and `/.well-known/did.json` for
 *   `did:web`, cached per context), and read without authentication, so only public records
 *   resolve. The client's PDS is not used for those reads because it would forward
 *   them to its AppView, which may not index the record or may return an outdated CID.
 * - Never falls back to an indexer: a failed read throws.
 * - Does not check the record's type or value, or whether the caller may reference it. That is
 *   the calling operation's decision, and it imposes no same-owner restriction.
 *
 * Throws TypeError for a URI that is not `at://<did>/<collection>/<rkey>` (handle authorities are
 * rejected because a stored reference must not change when the handle does), and Error when the
 * owner's PDS cannot be resolved, the record does not exist, the read fails, or the PDS returns
 * no CID.
 */
export async function readRecord(
  context: SDKContext,
  uri: string,
  operation: string,
  pdsClients?: PdsClients,
): Promise<StoredRecord> {
  const { atUri: requested, did, collection, rkey } = parseRecordUri(uri, operation);
  let response: Awaited<ReturnType<Client["getRecord"]>>;
  try {
    const client = await clientForRepo(context, did, pdsClients);
    response = await client.getRecord(collection, rkey, { repo: did });
  } catch (error) {
    const reason = isRecordNotFound(error)
      ? "the record was not found"
      : `the read failed (${describeError(error)})`;
    throw new Error(`${operation}: cannot resolve ${uri}: ${reason}.`, { cause: error });
  }
  // Checked here as well as by the client, because an application can turn off the client's
  // response validation and an unchecked reference would be written into a record.
  const body: unknown = response.body;
  if (!strongRef.main.matches(body)) {
    throw new Error(
      `${operation}: cannot resolve ${uri}: the PDS returned the record without a valid URI and CID.`,
    );
  }
  if (body.uri !== requested) {
    throw new Error(
      `${operation}: cannot resolve ${uri}: the PDS returned a different record (${body.uri}).`,
    );
  }
  return { ref: { uri: requested, cid: body.cid }, value: response.body.value };
}

/**
 * Whether the client's own repo holds a record at `collection` and `rkey`, read with
 * `com.atproto.repo.getRecord` through the client.
 *
 * Internal. Used to find out, before anything is written, whether a record key that the caller
 * chose is already taken. The answer is a snapshot: it does not stop another writer taking the key
 * afterwards.
 *
 * Throws what the client throws when the read fails for any reason other than the record being
 * absent.
 */
export async function recordExists(
  context: SDKContext,
  did: DidString,
  collection: NsidString,
  rkey: RecordKeyString,
): Promise<boolean> {
  try {
    await context.client.getRecord(collection, rkey, { repo: did });
    return true;
  } catch (error) {
    if (isRecordNotFound(error)) return false;
    throw error;
  }
}

/**
 * Clients for other accounts' PDSes, keyed by DID, so that reads of several records from one
 * account share a single DID resolution, including reads still in flight. Scope one map to one
 * operation: a DID's PDS can change.
 */
export type PdsClients = Map<DidString, Promise<Client>>;

async function clientForRepo(
  context: SDKContext,
  did: DidString,
  pdsClients?: PdsClients,
): Promise<Client> {
  if (context.client.did === did) return context.client;
  let pending = pdsClients?.get(did);
  if (pending === undefined) {
    pending = resolvePds(context, did).then((pds) => new Client(pds));
    pdsClients?.set(did, pending);
  }
  return pending;
}

/**
 * Splits a record URI into its parts without sending any request.
 *
 * Internal. Throws TypeError, naming `operation`, unless `uri` is `at://<did>/<collection>/<rkey>`.
 */
export function parseRecordUri(uri: string, operation: string) {
  // `at-uri` alone also accepts handle authorities and URIs without a collection or record key.
  if (!atUri.matches(uri)) throw notARecordUri(uri, operation);
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
  throw notARecordUri(uri, operation);
}

function notARecordUri(uri: string, operation: string): TypeError {
  return new TypeError(
    `${operation}: ${JSON.stringify(uri)} is not a record URI. Expected at://<did>/<collection>/<rkey>, for example at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8. Handles are not accepted as the authority.`,
  );
}
