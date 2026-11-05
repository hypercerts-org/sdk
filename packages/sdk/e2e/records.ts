import {
  type CidString,
  type Client,
  type DidString,
  isDidString,
  isNsidString,
  isPlainObject,
  isTypedBlobRef,
  type LexMap,
  type NsidString,
  type TypedBlobRef,
} from "@atproto/lex";
import * as location from "@hypercerts-org/lexicon/app/certified/location";
import * as activity from "@hypercerts-org/lexicon/org/hypercerts/claim/activity";
import * as contribution from "@hypercerts-org/lexicon/org/hypercerts/claim/contribution";
import * as contributorInformation from "@hypercerts-org/lexicon/org/hypercerts/claim/contributorInformation";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { expect } from "vitest";

/** A strong reference: a record's URI and the CID of one version of it. */
export interface Ref {
  uri: string;
  cid: string;
}

/** Narrows a value a test has just shown to exist, such as an element of a result's array. */
export function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value but got undefined.");
  return value;
}

function parseRecordUri(uri: string): { did: DidString; collection: NsidString; rkey: string } {
  const [, did, collection, rkey] = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri) ?? [];
  if (!isDidString(did) || !isNsidString(collection) || !rkey) {
    throw new Error(`Expected at://<did>/<collection>/<rkey>, got ${uri}.`);
  }
  return { did, collection, rkey };
}

/**
 * Reads the record at `ref.uri` from the PDS and checks that it stores the version `ref.cid` names.
 * Returns the stored value.
 */
export async function expectStored(reader: Client, ref: Ref): Promise<LexMap> {
  const { did, collection, rkey } = parseRecordUri(ref.uri);
  const { body } = await reader.getRecord(collection, rkey, { repo: did });
  expect(body.uri).toBe(ref.uri);
  expect(body.cid).toBe(ref.cid);
  expect(body.value.$type).toBe(collection);
  return body.value;
}

/** Every strong reference inside a record value, at any depth. */
export function strongRefsIn(value: unknown): Ref[] {
  if (Array.isArray(value)) return value.flatMap(strongRefsIn);
  if (!isPlainObject(value)) return [];
  const nested = Object.values(value).flatMap(strongRefsIn);
  const { uri, cid } = value;
  const isRef = typeof uri === "string" && uri.startsWith("at://") && typeof cid === "string";
  return isRef ? [{ uri, cid }, ...nested] : nested;
}

/**
 * Checks that every strong reference inside `record` points at a record the PDS stores with
 * exactly the referenced CID, and returns the references it found.
 */
export async function expectReferencesResolve(reader: Client, record: LexMap): Promise<Ref[]> {
  const refs = strongRefsIn(record);
  await Promise.all(refs.map((ref) => expectStored(reader, ref)));
  return refs;
}

/** The collections the SDK creates records in, named by the lexicon packages, not retyped here. */
export const collections = {
  activity: activity.main.$type,
  rights: rights.main.$type,
  location: location.main.$type,
  contributorInformation: contributorInformation.main.$type,
  contribution: contribution.main.$type,
} as const;

/** The number of records of `collection` in the client's repo. */
export async function countRecords(client: Client, collection: NsidString): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const { body } = await client.listRecords(collection, {
      repo: client.assertDid,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    count += body.records.length;
    cursor = body.cursor;
  } while (cursor !== undefined);
  return count;
}

/** How many records the client's repo holds in each of the collections the SDK writes to. */
export async function snapshotCounts(client: Client) {
  const entries = await Promise.all(
    Object.entries(collections).map(async ([name, collection]) => [
      name,
      await countRecords(client, collection),
    ]),
  );
  return Object.fromEntries(entries) as Record<keyof typeof collections, number>;
}

/** The blob reference a stored record holds in `value[field]`, for example `smallBlob.blob`. */
export function blobIn(value: unknown, field: "blob" | "image"): TypedBlobRef {
  const blob = isPlainObject(value) ? value[field] : undefined;
  if (!isTypedBlobRef(blob)) throw new Error(`Expected a blob reference in \`${field}\`.`);
  return blob;
}

/** Checks that the PDS serves the blob `ref` of `did` with the same bytes that were uploaded. */
export async function expectBlobServed(
  reader: Client,
  did: DidString,
  blob: TypedBlobRef,
  bytes: Uint8Array,
): Promise<void> {
  expect(blob.size).toBe(bytes.byteLength);
  const { body } = await reader.getBlob(did, blob.ref.toString() as CidString);
  expect(new Uint8Array(body)).toEqual(bytes);
}
