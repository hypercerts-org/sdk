import type { DidString, NsidString } from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import type { SDKContext } from "../context.js";
import { describeError } from "../internal/describe.js";
import type { StoredRecord } from "../internal/resolve-record-ref.js";

// The most `com.atproto.repo.listRecords` returns in one page.
const PAGE_SIZE = 100;

/**
 * Reads every record of `collection` in `did`'s repo, page after page, with
 * `com.atproto.repo.listRecords` through the client.
 *
 * Internal. Boundaries:
 * - The client's own repository, read from its own PDS: the typed record methods never go through
 *   an AppView, and no indexer is consulted.
 * - A page that cannot be read or does not look like a page of that collection is an error, never
 *   the end of the list: a caller that treats "no match" as "nothing to do" must not be fooled by
 *   an incomplete read. So is a cursor the PDS repeats, which would never end.
 * - The result is a snapshot: records written while the pages are read may or may not be in it.
 *
 * Throws Error, naming `operation`, when a page cannot be read or is malformed.
 */
export async function listCollection(
  context: SDKContext,
  did: DidString,
  collection: NsidString,
  operation: string,
): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readPage(context, { did, collection, cursor, operation });
    records.push(...page.records);
    cursor = page.cursor;
    if (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw incomplete(
          { did, collection, operation },
          `the PDS returned the cursor ${JSON.stringify(cursor)} twice`,
        );
      }
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return records;
}

interface Read {
  readonly did: DidString;
  readonly collection: NsidString;
  readonly operation: string;
}

async function readPage(
  context: SDKContext,
  read: Read & { readonly cursor: string | undefined },
): Promise<{ records: StoredRecord[]; cursor: string | undefined }> {
  const { did, collection, cursor } = read;
  let body: unknown;
  try {
    const response = await context.client.listRecords(collection, {
      repo: did,
      limit: PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    body = response.body;
  } catch (error) {
    throw incomplete(read, `the read failed (${describeError(error)})`, error);
  }
  return toPage(read, body);
}

function toPage(
  read: Read,
  body: unknown,
): { records: StoredRecord[]; cursor: string | undefined } {
  const { records, cursor } = (typeof body === "object" && body !== null ? body : {}) as {
    records?: unknown;
    cursor?: unknown;
  };
  if (!Array.isArray(records)) throw incomplete(read, "the PDS returned no list of records");
  if (cursor !== undefined && typeof cursor !== "string") {
    throw incomplete(read, "the PDS returned a cursor that is not a string");
  }
  return { records: records.map((entry) => toRecord(read, entry)), cursor };
}

// Checked here as well as by the client, because an application can turn off the client's
// response validation. A record the account does not own, or from another collection, is not
// deleted on the strength of a listing that claims it is one.
function toRecord(read: Read, entry: unknown): StoredRecord {
  if (!strongRef.main.matches(entry)) {
    throw incomplete(read, "a record has no valid URI and CID");
  }
  const { value } = entry as { value?: unknown };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw incomplete(read, `${entry.uri} has no value`);
  }
  const { did, collection } = read;
  if (!entry.uri.startsWith(`at://${did}/${collection}/`)) {
    throw incomplete(read, `${entry.uri} is not a ${collection} record of ${did}`);
  }
  return { ref: { uri: entry.uri, cid: entry.cid }, value: value as StoredRecord["value"] };
}

function incomplete({ did, collection, operation }: Read, reason: string, cause?: unknown): Error {
  return new Error(
    `${operation}: cannot read all ${collection} records of ${did}: ${reason}, so it is not known whether the account has a matching record. Nothing was changed. Call again; if it keeps failing, check the session and the PDS.`,
    cause === undefined ? undefined : { cause },
  );
}
