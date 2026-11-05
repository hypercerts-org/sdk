import { cidForRawBytes, type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { DID, fakePds, json, type RecordedRequest } from "./fake-pds.js";

/** One `create` the fake received in an `applyWrites` request, as the PDS would decode it. */
export interface ReceivedCreate {
  collection: string;
  rkey: string;
  value: LexMap;
  /** The CID the fake computed from the decoded value. */
  cid: string;
}

export interface FakeRepoOptions {
  /** Records that already exist in the repo being read, as URI to CID. */
  existing?: Record<string, string>;
  /** Replaces the fake's answer to `uploadBlob`, to simulate failures. */
  uploadBlob?: (request: RecordedRequest) => Response;
  /** Replaces the fake's answer to `applyWrites`, to simulate failures. */
  applyWrites?: (request: RecordedRequest) => Response;
}

/**
 * A fake PDS that behaves like the parts of a repo the creation functions use: it hands out blob
 * references for uploads, answers `getRecord` for `existing` records, and answers `applyWrites` by
 * decoding the request body from the wire and computing each record's CID from the decoded value.
 *
 * It stores nothing and cannot show that a real PDS commits a request atomically. The CIDs come
 * from the same CBOR encoder the reference PDS uses, so a matching CID shows that the SDK's
 * request round-trips through the wire format unchanged, not that every PDS agrees.
 */
export function fakeRepo(options: FakeRepoOptions = {}) {
  const creates: ReceivedCreate[][] = [];
  const pds = fakePds((request) => {
    const path = new URL(request.path, "https://pds.test").pathname;
    if (path.endsWith("com.atproto.repo.uploadBlob")) {
      return options.uploadBlob?.(request) ?? uploadBlob(request);
    }
    if (path.endsWith("com.atproto.repo.getRecord")) return getRecord(request, options.existing);
    if (path.endsWith("com.atproto.repo.applyWrites")) {
      return options.applyWrites?.(request) ?? applyWrites(request, creates);
    }
    return json(404, { error: "XRPCNotSupported", message: path });
  });
  return { ...pds, creates };
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

function getRecord(request: RecordedRequest, existing: Record<string, string> = {}): Response {
  const params = new URL(request.path, "https://pds.test").searchParams;
  const uri = `at://${params.get("repo")}/${params.get("collection")}/${params.get("rkey")}`;
  const cid = existing[uri];
  if (cid === undefined) return json(400, { error: "RecordNotFound", message: "not found" });
  return json(200, { uri, cid, value: { $type: params.get("collection") } });
}

async function applyWrites(
  request: RecordedRequest,
  received: ReceivedCreate[][],
): Promise<Response> {
  const body = lexParse(new TextDecoder().decode(request.body)) as unknown as {
    repo: string;
    writes: ReceivedCreate[];
  };
  const writes = await Promise.all(
    body.writes.map(async (write) => ({
      ...write,
      cid: (await cidForLex(write.value)).toString(),
    })),
  );
  received.push(writes);
  return json(200, {
    results: writes.map((write) => ({
      $type: "com.atproto.repo.applyWrites#createResult",
      uri: `at://${body.repo}/${write.collection}/${write.rkey}`,
      cid: write.cid,
    })),
  });
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
