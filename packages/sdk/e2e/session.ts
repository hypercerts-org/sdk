import { Client, type DidString, l } from "@atproto/lex";
import { createSDKContext, type SDKContext } from "../src/index.js";
import { type Credentials, readE2eEnv } from "./env.js";

// `com.atproto.server.createSession` is not among the lexicons bundled with `Client`.
const createSession = l.procedure(
  "com.atproto.server.createSession",
  l.params(),
  l.jsonPayload({ identifier: l.string(), password: l.string() }),
  l.jsonPayload({ accessJwt: l.string(), did: l.string({ format: "did" }) }),
);

/** A signed-in account: the client the SDK is given, and the context built from it. */
export interface Account {
  did: DidString;
  client: Client;
  context: SDKContext;
}

/**
 * Signs in with a password and returns a client that sends the access token with every request.
 *
 * @remarks
 * This is what an application's auth code does before it calls `createSDKContext`. The token is
 * not refreshed: a test run is far shorter than its lifetime.
 *
 * `rewrite` lets a test change a request, including its access token, just before it is sent, to
 * make the PDS see something the SDK would never send.
 *
 * @throws {@link Error} If the PDS cannot be reached or refuses the credentials.
 */
export async function login(
  pdsUrl: string,
  credentials: Credentials,
  rewrite: RewriteRequest = (_, init) => init,
): Promise<Account> {
  const { body } = await new Client({ service: pdsUrl }).xrpc(createSession, {
    body: credentials,
  });
  const client = new Client({
    did: body.did,
    fetchHandler: (path, init) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${body.accessJwt}`);
      return fetch(new URL(path, pdsUrl), rewrite(path, { ...init, headers }));
    },
  });
  return { did: body.did, client, context: createSDKContext({ client }) };
}

/** Changes the request to `path` before it is sent. */
export type RewriteRequest = (path: string, init: RequestInit) => RequestInit;

/** Signs in as one of the two accounts named by the environment. */
export function loginAs(user: "user1" | "user2", rewrite?: RewriteRequest): Promise<Account> {
  const env = readE2eEnv();
  return login(env.pdsUrl, env[user], rewrite);
}
