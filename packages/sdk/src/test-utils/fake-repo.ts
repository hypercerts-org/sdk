import { cidForRawBytes, type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { DID, fakePds, json, type RecordedRequest } from "./fake-pds.js";

// CIDv1 (raw, sha-256) of the bytes "head": the head commit the fake repo starts at.
export const HEAD = "bafkreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju";

/** One `create` or `update` the fake received in an `applyWrites` request, as the PDS would decode it. */
export interface ReceivedCreate {
  collection: string;
  rkey: string;
  value: LexMap;
  /** The CID the fake computed from the decoded value. */
  cid: string;
}

/** One `putRecord` the fake received, as the PDS would decode it. */
export interface ReceivedPut extends ReceivedCreate {
  /** The `swapRecord` of the request: `null` means "only if no record is there yet". */
  swapRecord: string | null | undefined;
}

/** The part of the fake's state a test may change while a call is running, as a concurrent writer would. */
export interface FakeRepoState {
  /** The CID of the repo's head commit, as `getLatestCommit` reports it and `swapCommit` is checked. */
  head: string;
}

export interface FakeRepoOptions {
  /** Records that already exist in the repo being read, as URI to CID. */
  existing?: Record<string, string>;
  /**
   * Records that exist with their full value, by URI, as JSON as it goes over the wire. `getRecord`
   * answers with the value and with the CID a PDS computes from it.
   */
  records?: Record<string, LexMap>;
  /** Called with the method of every request before it is answered. */
  onRequest?: (method: string, state: FakeRepoState) => void;
  /** Replaces the fake's answer to `putRecord`, to simulate failures. */
  putRecord?: (request: RecordedRequest) => Response;
  /** Replaces the fake's answer to `getLatestCommit`, to simulate failures. */
  getLatestCommit?: (request: RecordedRequest) => Response;
  /** Answers `listRecords`; without it the fake answers HTTP 404, as it does for any method it does not know. */
  listRecords?: (request: RecordedRequest) => Response | Promise<Response>;
  /** Answers `deleteRecord`; without it the fake answers HTTP 404, as it does for any method it does not know. */
  deleteRecord?: (request: RecordedRequest) => Response | Promise<Response>;
  /** Replaces the fake's answer to `uploadBlob`, to simulate failures. */
  uploadBlob?: (request: RecordedRequest) => Response;
  /** Replaces the fake's answer to `applyWrites`, to simulate failures. */
  applyWrites?: (request: RecordedRequest) => Response;
}

/**
 * A fake PDS that behaves like the parts of a repo the creation functions use: it hands out blob
 * references for uploads, answers `getRecord` for `existing` and `records`, reports the head commit
 * with `getLatestCommit`, and answers `applyWrites` by decoding the request body from the wire and
 * computing each record's CID from the decoded value. An `applyWrites` request with a `swapCommit`
 * other than the current head is refused with `InvalidSwap`, as a PDS refuses it. It answers
 * `putRecord` the same way, except that `swapRecord: null` ("only if absent") fails with
 * `InvalidSwap`, as the reference PDS does, when the record is in `existing`.
 *
 * It stores nothing and cannot show that a real PDS commits a request atomically. The CIDs come
 * from the same CBOR encoder the reference PDS uses, so a matching CID shows that the SDK's
 * request round-trips through the wire format unchanged, not that every PDS agrees.
 */
export function fakeRepo(options: FakeRepoOptions = {}) {
  const received: ReceivedWrites = { creates: [], updates: [], swapCommits: [] };
  const puts: ReceivedPut[] = [];
  const state: FakeRepoState = { head: HEAD };
  const pds = fakePds((request) => {
    const path = new URL(request.path, "https://pds.test").pathname;
    options.onRequest?.(path.slice(6), state);
    if (path.endsWith("com.atproto.repo.uploadBlob")) {
      return options.uploadBlob?.(request) ?? uploadBlob(request);
    }
    if (path.endsWith("com.atproto.repo.getRecord")) {
      return getRecord(request, options.existing, options.records);
    }
    if (path.endsWith("com.atproto.sync.getLatestCommit")) {
      return (
        options.getLatestCommit?.(request) ?? json(200, { cid: state.head, rev: "3k2a4b5c6d7e8" })
      );
    }
    if (path.endsWith("com.atproto.repo.applyWrites")) {
      return options.applyWrites?.(request) ?? applyWrites(request, received, state);
    }
    if (path.endsWith("com.atproto.repo.listRecords") && options.listRecords) {
      return options.listRecords(request);
    }
    if (path.endsWith("com.atproto.repo.deleteRecord") && options.deleteRecord) {
      return options.deleteRecord(request);
    }
    if (path.endsWith("com.atproto.repo.putRecord")) {
      return options.putRecord?.(request) ?? putRecord(request, puts, options.existing);
    }
    return json(404, { error: "XRPCNotSupported", message: path });
  });
  const { creates, updates, swapCommits } = received;
  return { ...pds, creates, updates, swapCommits, puts, state };
}

// What the default `applyWrites` answer received, one entry per request.
interface ReceivedWrites {
  creates: ReceivedCreate[][];
  updates: ReceivedCreate[][];
  swapCommits: (string | undefined)[];
}

/** The paths of the requests the fake received, for example `com.atproto.repo.applyWrites`. */
export function methods(requests: readonly RecordedRequest[]): string[] {
  return requests.map((request) => new URL(request.path, "https://pds.test").pathname.slice(6));
}

function uploadBlob(request: RecordedRequest): Promise<Response> | Response {
  const bytes = request.body ?? new Uint8Array();
  return cidForRawBytes(bytes).then((cid) =>
    json(200, {
      blob: {
        $type: "blob",
        ref: { $link: cid.toString() },
        mimeType: request.headers.get("content-type"),
        size: bytes.byteLength,
      },
    }),
  );
}

async function getRecord(
  request: RecordedRequest,
  existing: Record<string, string> = {},
  records: Record<string, LexMap> = {},
): Promise<Response> {
  const params = new URL(request.path, "https://pds.test").searchParams;
  const uri = `at://${params.get("repo")}/${params.get("collection")}/${params.get("rkey")}`;
  const value = records[uri];
  if (value !== undefined) {
    // The CID is computed from the value as the client decodes it, as a PDS does from what it stores.
    const cid = (await cidForLex(lexParse(JSON.stringify(value)))).toString();
    return json(200, { uri, cid, value });
  }
  const cid = existing[uri];
  if (cid === undefined) return json(400, { error: "RecordNotFound", message: "not found" });
  return json(200, { uri, cid, value: { $type: params.get("collection") } });
}

async function applyWrites(
  request: RecordedRequest,
  received: ReceivedWrites,
  state: FakeRepoState,
): Promise<Response> {
  const body = lexParse(new TextDecoder().decode(request.body)) as unknown as {
    repo: string;
    writes: (ReceivedCreate & { $type: string })[];
    swapCommit?: string;
  };
  if (body.swapCommit !== undefined && body.swapCommit !== state.head) {
    return json(400, {
      error: "InvalidSwap",
      message: `Commit was at ${state.head}`,
    });
  }
  const writes = await Promise.all(
    body.writes.map(async (write) => ({
      ...write,
      cid: (await cidForLex(write.value)).toString(),
    })),
  );
  received.creates.push(writes.filter((write) => write.$type.endsWith("#create")));
  received.updates.push(writes.filter((write) => write.$type.endsWith("#update")));
  received.swapCommits.push(body.swapCommit);
  return json(200, {
    results: writes.map((write) => ({
      $type: `com.atproto.repo.applyWrites#${write.$type.endsWith("#update") ? "update" : "create"}Result`,
      uri: `at://${body.repo}/${write.collection}/${write.rkey}`,
      cid: write.cid,
    })),
  });
}

async function putRecord(
  request: RecordedRequest,
  received: ReceivedPut[],
  existing: Record<string, string> = {},
): Promise<Response> {
  const body = lexParse(new TextDecoder().decode(request.body)) as unknown as {
    repo: string;
    collection: string;
    rkey: string;
    record: LexMap;
    swapRecord?: string | null;
  };
  const uri = `at://${body.repo}/${body.collection}/${body.rkey}`;
  const current = existing[uri];
  if (body.swapRecord === null && current !== undefined) {
    return json(400, { error: "InvalidSwap", message: `Record was at ${current}` });
  }
  const cid = (await cidForLex(body.record)).toString();
  received.push({
    collection: body.collection,
    rkey: body.rkey,
    value: body.record,
    cid,
    swapRecord: body.swapRecord,
  });
  return json(200, { uri, cid });
}

/** The create that wrote a record of `collection`. */
export function writeOf(writes: readonly ReceivedCreate[], collection: string): ReceivedCreate {
  const write = writes.find((candidate) => candidate.collection === collection);
  if (write === undefined) throw new Error(`no write to ${collection} in the request`);
  return write;
}

/** The URI and CID a created record has, as a strong reference to it. */
export function refTo({ collection, rkey, cid }: ReceivedCreate) {
  return { uri: `at://${DID}/${collection}/${rkey}`, cid };
}
