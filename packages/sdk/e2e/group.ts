import { type DidString, l } from "@atproto/lex";
import { vi } from "vitest";
import { createSDKContext, type SDKContext } from "../src/index.js";
import { readE2eEnv } from "./env.js";
import type { Account } from "./session.js";

// The tests' own calls to CGS must not show up among the SDK's requests that `watchCgs` records,
// so they use the `fetch` of the time this module was loaded, before any test replaces it.
const nativeFetch = globalThis.fetch;

/** The service id of CGS's DID document entry, the fragment of the token's `aud`. */
export const CGS_SERVICE_ID = "certified_group_service";

// `com.atproto.server.getServiceAuth` is not among the lexicons bundled with `Client`.
const getServiceAuth = l.query(
  "com.atproto.server.getServiceAuth",
  l.params({ aud: l.string(), lxm: l.string({ format: "nsid" }) }),
  l.jsonPayload({ token: l.string() }),
);

/** What CGS answered. `body` is the parsed JSON, or the text if it was not JSON. */
export interface CgsAnswer {
  status: number;
  body: unknown;
}

/**
 * Posts to a CGS method as `caller`, with a service-auth token the caller's own PDS issued for
 * `aud` `<cgs did>#certified_group_service` and `lxm` the method. This is what an application
 * that is not the SDK does to administer a group (register it, add members), and what the tests
 * use to set up and disturb the group the SDK writes to. `aud` replaces the audience, to show that
 * CGS refuses a token meant for another service.
 */
export async function callCgs(
  caller: Account,
  nsid: string,
  body: object,
  aud?: string,
): Promise<CgsAnswer> {
  const { cgs } = readE2eEnv();
  const { body: issued } = await caller.client.xrpc(getServiceAuth, {
    params: { aud: aud ?? `${cgs.did}#${CGS_SERVICE_ID}`, lxm: nsid as never },
    service: null,
    labelers: null,
  });
  const response = await nativeFetch(`${cgs.url}/xrpc/${nsid}`, {
    method: "POST",
    headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

/** Like {@link callCgs}, but throws, naming the method and the answer, unless CGS answered 2xx. */
export async function mustCallCgs<T = Record<string, unknown>>(
  caller: Account,
  nsid: string,
  body: object,
  aud?: string,
): Promise<T> {
  const answer = await callCgs(caller, nsid, body, aud);
  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(`CGS ${nsid} answered HTTP ${answer.status}: ${JSON.stringify(answer.body)}`);
  }
  return answer.body as T;
}

/** Registers a new group owned by `owner`: CGS creates the group's account on the sandbox PDS. */
export async function registerGroup(owner: Account, name: string): Promise<DidString> {
  const { groupDid } = await mustCallCgs<{ groupDid: DidString }>(
    owner,
    "app.certified.group.register",
    { handle: name, ownerDid: owner.did },
    // `register` is a service-level method: CGS wants the bare service DID, with no fragment, as
    // `aud`, because the group does not exist yet. The group methods take `<did>#<service id>`.
    readE2eEnv().cgs.did,
  );
  return groupDid;
}

/** Adds `member` to the group with `role`, as `actor` (an owner or admin of it). */
export async function addMember(
  actor: Account,
  groupDid: DidString,
  member: Account,
  role: "member" | "admin",
): Promise<void> {
  await mustCallCgs(actor, "app.certified.group.member.add", {
    repo: groupDid,
    memberDid: member.did,
    role,
  });
}

/** Changes the role of an existing member, as the group's owner. */
export async function setRole(
  owner: Account,
  groupDid: DidString,
  member: Account,
  role: "member" | "admin",
): Promise<void> {
  await mustCallCgs(owner, "app.certified.group.role.set", {
    repo: groupDid,
    memberDid: member.did,
    role,
  });
}

/** An API key CGS minted: the secret `key` (shown once) and its non-secret `keyRef`. */
export interface MintedKey {
  key: string;
  keyRef: string;
}

/**
 * Mints an API key for the group as `creator`, a member, with `scopes` (such as
 * `repo:<collection>?action=create` or `blob:image/*`). Like `callCgs`, this is what an application
 * does with `app.certified.group.keys.create`; the SDK has no wrapper for it. CGS refuses to mint a
 * key with a key, so it goes over service auth.
 */
export async function createApiKey(
  creator: Account,
  groupDid: DidString,
  scopes: readonly string[],
): Promise<MintedKey> {
  return mustCallCgs<MintedKey>(creator, "app.certified.group.keys.create", {
    repo: groupDid,
    name: `sdk-e2e-${Date.now()}`,
    scopes,
  });
}

/** Revokes a key as `actor` (its creator, or the group's owner). The key is refused on its next use. */
export async function revokeApiKey(
  actor: Account,
  groupDid: DidString,
  keyRef: string,
): Promise<void> {
  await mustCallCgs(actor, "app.certified.group.keys.delete", { repo: groupDid, keyRef });
}

/** A context with nothing but the group key: no client, no account. */
export function apiKeyContext(key: string): SDKContext {
  const { cgs } = readE2eEnv();
  return createSDKContext({ cgs: { url: cgs.url, did: cgs.did, auth: { kind: "apiKey", key } } });
}

/** A request the SDK sent to CGS, as the tests saw it. */
export interface CgsRequest {
  nsid: string;
  /** The service-auth token, the claims of which tests check. */
  token: string;
  body: Record<string, unknown>;
  /** The `X-API-Key` header, empty when the SDK authenticated with a service-auth token. */
  apiKey: string;
}

/**
 * Watches the requests the SDK sends to CGS while a test runs, and lets the test act just before
 * one is sent (`before`, which may be asynchronous). Undone by `vi.unstubAllGlobals()`.
 *
 * @remarks
 * `before` runs after the SDK has read what it will write and has its token, so a test can change
 * the records the SDK is about to write over, which no sequential test can do.
 */
export function watchCgs(before?: (request: CgsRequest) => Promise<void> | void): CgsRequest[] {
  const env = readE2eEnv();
  const realFetch = globalThis.fetch;
  const seen: CgsRequest[] = [];
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== new URL(env.cgs.url).origin) return realFetch(input, init);
    const text = await request.clone().text();
    const seenRequest: CgsRequest = {
      nsid: new URL(request.url).pathname.replace("/xrpc/", ""),
      token: request.headers.get("authorization")?.replace("Bearer ", "") ?? "",
      apiKey: request.headers.get("x-api-key") ?? "",
      body: text.startsWith("{") ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
    seen.push(seenRequest);
    await before?.(seenRequest);
    return realFetch(request);
  });
  return seen;
}

/** The claims of a JWT, without checking its signature. */
export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString());
}
