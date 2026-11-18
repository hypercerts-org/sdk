import { Client, cidForRawBytes, type LexMap, lexParse, lexStringify } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { vi } from "vitest";
import { createSDKContext, type SDKContext } from "../context.js";
import { DID, json, type RecordedRequest } from "./fake-pds.js";
import { HEAD } from "./fake-repo.js";

export const CGS_URL = "https://cgs.test";
export const CGS_DID = "did:web:cgs.test";
/** The `aud` of the tokens the SDK asks for: CGS's DID with its service id, as an OAuth `rpc:` scope names it. */
export const CGS_AUD = `${CGS_DID}#certified_group_service`;
/** The organization (group) repo, and the PDS that hosts it. */
export const ORG = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
export const ORG_PDS = "https://org-pds.test";

/** A request the fake CGS received. */
export interface CgsRequest {
  /** The method, for example `app.certified.group.repo.createRecord`. */
  method: string;
  /** The querystring parameters. */
  params: Record<string, string>;
  /** The decoded JSON body; undefined for a blob upload. */
  body: Record<string, unknown> | undefined;
  /** The raw body. */
  bytes: Uint8Array;
  headers: Headers;
}

/** A service-auth token the fake account PDS issued. */
export interface IssuedToken {
  aud: string;
  lxm: string;
  jti: string;
}

export interface FakeCgsOptions {
  /** Records that exist in the org repo, by URI, with their full value. */
  records?: Record<string, LexMap>;
  /**
   * Replaces the fake's answer to a CGS request. Return undefined to let the fake answer. `index` counts
   * CGS requests from 0, across all methods.
   */
  answer?: (request: CgsRequest, index: number) => Response | undefined;
  /** Makes the account's PDS refuse `getServiceAuth` when this returns a response; `index` counts token requests from 0. */
  refuseServiceAuth?: (index: number) => Response | undefined;
  /** The caller is a member, not an admin: deleting a record that has no author row answers 403, as CGS does. */
  memberDeletes?: boolean;
}

/**
 * A fake Certified Group Service with the account's PDS (which issues service-auth tokens) and the
 * organization's PDS (which serves reads) behind it. It replaces the global `fetch`; call
 * `vi.unstubAllGlobals()` after each test.
 *
 * Like the real service it checks that every request carries a token for its own method and
 * audience that was not used before, requires `repo` on the querystring of an upload, stores what
 * is written so later reads see it, enforces `swapRecord` as the PDS does, and answers `createRecord`
 * at a taken key with HTTP 502, the way CGS turns the PDS's 500.
 */
export function fakeCgs(options: FakeCgsOptions = {}) {
  const store = new Map<string, { cid: string; value: LexMap }>();
  const seed = Object.entries(options.records ?? {}).map(async ([uri, value]) => {
    store.set(uri, { cid: await cidOf(lexParse(JSON.stringify(value))), value });
  });
  const requests: CgsRequest[] = [];
  const tokens: IssuedToken[] = [];
  const used = new Set<string>();
  /** Every request, in order, as `<host> <method>`, so a test can see order across services. */
  const calls: string[] = [];
  let tokenCount = 0;
  let tokenRequests = 0;

  const accountPds = (request: RecordedRequest): Response => {
    const url = new URL(request.path, "https://account-pds.test");
    calls.push(`account ${url.pathname.slice(6)}`);
    if (url.pathname.endsWith("com.atproto.server.getServiceAuth")) {
      const refused = options.refuseServiceAuth?.(tokenRequests++);
      if (refused !== undefined) return refused;
      const token: IssuedToken = {
        aud: url.searchParams.get("aud") ?? "",
        lxm: url.searchParams.get("lxm") ?? "",
        jti: `jti-${tokenCount++}`,
      };
      tokens.push(token);
      return json(200, { token: btoa(JSON.stringify(token)) });
    }
    return json(404, { error: "XRPCNotSupported", message: url.pathname });
  };

  const client = new Client({
    did: DID,
    fetchHandler: async (path, init) =>
      accountPds({
        path,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: undefined,
      }),
  });
  const context: SDKContext = createSDKContext({
    client,
    cgs: { url: CGS_URL, did: CGS_DID },
    didResolver: {
      resolve: async () => ({
        id: ORG,
        service: [
          { id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: ORG_PDS },
        ],
      }),
    },
  });

  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    await Promise.all(seed);
    const url = new URL(input instanceof Request ? input.url : String(input));
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    if (url.origin === CGS_URL) return cgs(url, new Headers(init?.headers), bytes);
    if (url.origin === ORG_PDS) return orgPds(url);
    return json(404, { error: "NotFound", message: url.href });
  });

  async function cgs(url: URL, headers: Headers, bytes: Uint8Array): Promise<Response> {
    const method = url.pathname.slice("/xrpc/".length);
    const isBlob = method.endsWith("uploadBlob");
    const request: CgsRequest = {
      method,
      params: Object.fromEntries(url.searchParams),
      body: isBlob ? undefined : (lexParse(new TextDecoder().decode(bytes)) as never),
      bytes,
      headers,
    };
    const index = requests.length;
    requests.push(request);
    calls.push(`cgs ${method}`);
    const refused = checkToken(request);
    if (refused !== undefined) return refused;
    return options.answer?.(request, index) ?? (await handle(request));
  }

  function checkToken({ method, headers }: CgsRequest): Response | undefined {
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    const token = bearer === undefined ? undefined : (JSON.parse(atob(bearer)) as IssuedToken);
    if (token === undefined || token.aud !== CGS_AUD || token.lxm !== method) {
      return json(401, { error: "AuthRequired", message: "token not for this method" });
    }
    if (used.has(token.jti)) return json(401, { error: "AuthRequired", message: "jti reused" });
    used.add(token.jti);
    return undefined;
  }

  async function handle({ method, params, body, bytes, headers }: CgsRequest): Promise<Response> {
    if (method.endsWith("uploadBlob")) {
      if (params.repo !== ORG) {
        return json(400, { error: "InvalidRequest", message: "repo is required" });
      }
      return json(200, {
        blob: {
          $type: "blob",
          ref: { $link: (await cidForRawBytes(bytes)).toString() },
          mimeType: headers.get("content-type"),
          size: bytes.byteLength,
        },
      });
    }
    const { repo, collection, rkey, record, swapRecord } = body as {
      repo: string;
      collection: string;
      rkey: string;
      record: LexMap;
      swapRecord?: string | null;
    };
    if (body?.swapCommit !== undefined) throw new Error("the SDK must never send swapCommit");
    const uri = `at://${repo}/${collection}/${rkey}`;
    const current = store.get(uri);
    if (method.endsWith("createRecord")) {
      if (current !== undefined) {
        return json(502, { error: "UpstreamFailure", message: "upstream request failed" });
      }
      return put(uri, record);
    }
    if (method.endsWith("putRecord")) {
      if (swapRecord !== undefined && swapRecord !== (current?.cid ?? null)) {
        return json(400, { error: "InvalidSwap", message: `Record was at ${current?.cid}` });
      }
      return put(uri, record);
    }
    if (current === undefined && options.memberDeletes) {
      return json(403, { error: "Forbidden", message: "requires admin" });
    }
    if (swapRecord !== undefined && swapRecord !== current?.cid) {
      return json(400, { error: "InvalidSwap", message: `Record was at ${current?.cid}` });
    }
    store.delete(uri);
    return json(200, {});
  }

  async function put(uri: string, record: LexMap): Promise<Response> {
    const cid = await cidOf(record);
    store.set(uri, { cid, value: record });
    return json(200, { uri, cid });
  }

  function orgPds(url: URL): Response {
    calls.push(`org ${url.pathname.slice(6)}`);
    if (url.pathname.endsWith("com.atproto.sync.getLatestCommit")) {
      return json(200, { cid: HEAD, rev: "3k2a4b5c6d7e8" });
    }
    if (url.pathname.endsWith("com.atproto.repo.getRecord")) {
      const { searchParams } = url;
      const uri = `at://${searchParams.get("repo")}/${searchParams.get("collection")}/${searchParams.get("rkey")}`;
      const found = store.get(uri);
      if (found === undefined) return json(400, { error: "RecordNotFound", message: "not found" });
      return json(200, { uri, cid: found.cid, value: JSON.parse(lexStringify(found.value)) });
    }
    return json(404, { error: "XRPCNotSupported", message: url.pathname });
  }

  return {
    context,
    requests,
    tokens,
    calls,
    /** The org repo's records, by URI. */
    store,
    /** The CGS requests of one method. */
    of: (method: string) => requests.filter((request) => request.method.endsWith(`.${method}`)),
  };
}

// The CID a PDS computes from a value as it decoded it from the wire.
async function cidOf(value: LexMap): Promise<string> {
  return (await cidForLex(value)).toString();
}
