import { type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { json } from "./fake-pds.js";
import { type FakeRepoOptions, fakeRepo } from "./fake-repo.js";

/** A record the fake holds. `cid` defaults to the CID a PDS computes from `value`. */
export interface StoredEntry {
  rkey: string;
  value: LexMap;
  cid?: string;
}

export interface FakeCollectionOptions extends FakeRepoOptions {
  /** The records the repo holds, by collection, in the order `listRecords` returns them. */
  entries?: Record<string, StoredEntry[]>;
  /** How many records one `listRecords` page holds at most. Default: as many as the request asks for. */
  pageSize?: number;
}

/** One `deleteRecord` request the fake received. */
export interface ReceivedDelete {
  repo: string;
  collection: string;
  rkey: string;
  swapRecord?: string | undefined;
}

/** The query of one `listRecords` request the fake received. */
export interface ReceivedList {
  repo: string | null;
  collection: string | null;
  cursor: string | null;
  limit: string | null;
}

/**
 * A fake repo that also lists and deletes records of the collections in `entries`: `listRecords`
 * pages through them with a cursor, and `deleteRecord` removes a record, refusing with
 * `InvalidSwap` when its `swapRecord` is not the record's CID. Everything else is `fakeRepo`'s.
 * `listRecords` and `deleteRecord` in the options replace these answers, to simulate failures.
 */
export function fakeCollection(options: FakeCollectionOptions = {}) {
  const { entries = {}, pageSize, ...repoOptions } = options;
  const deletes: ReceivedDelete[] = [];
  const lists: ReceivedList[] = [];
  const repo = fakeRepo({
    ...repoOptions,
    listRecords:
      repoOptions.listRecords ??
      (async (request) => {
        const query = new URL(request.path, "https://pds.test").searchParams;
        const list = {
          repo: query.get("repo"),
          collection: query.get("collection"),
          cursor: query.get("cursor"),
          limit: query.get("limit"),
        };
        lists.push(list);
        return page(entries[list.collection ?? ""] ?? [], list, pageSize);
      }),
    deleteRecord:
      repoOptions.deleteRecord ??
      (async (request) => {
        const body = JSON.parse(new TextDecoder().decode(request.body)) as ReceivedDelete;
        deletes.push(body);
        return remove(entries[body.collection] ?? [], body);
      }),
  });
  return { ...repo, deletes, lists };
}

async function cidOf(entry: StoredEntry): Promise<string> {
  // As a PDS computes it, from the value as the client decodes it.
  return entry.cid ?? (await cidForLex(lexParse(JSON.stringify(entry.value)))).toString();
}

async function page(
  all: readonly StoredEntry[],
  list: ReceivedList,
  pageSize: number | undefined,
): Promise<Response> {
  const start = list.cursor === null ? 0 : Number(list.cursor);
  const size = Math.min(pageSize ?? Infinity, Number(list.limit ?? 50));
  const slice = all.slice(start, start + size);
  const records = await Promise.all(
    slice.map(async (entry) => ({
      uri: `at://${list.repo}/${list.collection}/${entry.rkey}`,
      cid: await cidOf(entry),
      value: entry.value,
    })),
  );
  const next = start + slice.length;
  return json(200, { records, ...(next < all.length ? { cursor: String(next) } : {}) });
}

async function remove(entries: StoredEntry[], body: ReceivedDelete): Promise<Response> {
  const index = entries.findIndex((entry) => entry.rkey === body.rkey);
  const current = entries[index];
  if (
    body.swapRecord !== undefined &&
    (current === undefined || (await cidOf(current)) !== body.swapRecord)
  ) {
    return json(400, { error: "InvalidSwap", message: "Record CID did not match" });
  }
  if (index >= 0) entries.splice(index, 1);
  return json(200, {});
}
