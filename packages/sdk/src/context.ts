import { type Client, type DidString, isDidString } from "@atproto/lex";
import type { AtprotoDid, AtprotoDidDocument } from "@atproto-labs/did-resolver";
import { describeValue } from "./internal/describe.js";
import { createDefaultDidResolver } from "./internal/resolve-pds.js";

/**
 * Shared context passed as the first argument to every SDK operation.
 *
 * @remarks
 * Create it once with {@link createSDKContext} and reuse it for every call. It is frozen and
 * holds only the application's client and a DID resolver: no session, credentials or HTTP client
 * of its own. Create a new context when the application replaces its client, for example after
 * signing in as another account.
 *
 * @example
 * ```ts
 * import { createAttachment } from "@hypercerts-org/sdk/<domain>"; // not implemented yet
 *
 * await createAttachment(context, input);
 * ```
 */
export interface SDKContext {
  /**
   * The application's `@atproto/lex` client. Operations send all their requests through it.
   * Absent only when `cgs.auth` is an API key: such a context has no account of its own.
   */
  readonly client?: Client | undefined;
  /**
   * Finds the DID document of an account other than the client's, to locate its PDS. The
   * resolver passed to {@link createSDKContext}, or the SDK's cached default.
   */
  readonly didResolver: DidDocumentResolver;
  /**
   * The Certified Group Service that organization writes go through, when the context was created
   * with one. See {@link CgsConfig}.
   */
  readonly cgs?: CgsConfig | undefined;
}

/**
 * Where the Certified Group Service (CGS) is, for writes to an organization's repository (see
 * {@link WriteOptions}). The same for every organization the service hosts.
 */
export interface CgsConfig {
  /** The service's base URL, for example `https://cgs.example.com`. Requests go to `<url>/xrpc/<method>`. */
  readonly url: string;
  /**
   * The service's DID without a fragment, for example `did:web:cgs.example.com`. The SDK appends
   * `#certified_group_service` itself: the token it asks the account's PDS for has that
   * `did#service` reference as its `aud`, which is what an OAuth `rpc:` scope must name.
   */
  readonly did: DidString;
  /** How requests to the service are authenticated. Default: `{ kind: "serviceAuth" }`. */
  readonly auth?: CgsAuth | undefined;
}

/**
 * How the SDK authenticates to the Certified Group Service.
 *
 * @remarks
 * - `serviceAuth` (default): the signed-in account acts. For each request the SDK asks the client's
 *   PDS for a single-use token.
 * - `apiKey`: the key acts as the group member who created it, limited to the key's scopes and
 *   that member's current role. Needs no client and no PDS round trip, but every write must pass
 *   `{ repo: groupDid }`: a key belongs to one group and the context has no own repository.
 *   Server-side only: a key is a long-lived secret, so store it like a password. The SDK never
 *   logs it and never puts it in an error; messages name only its `cgsk_<ref>` part.
 */
export type CgsAuth =
  | { readonly kind: "serviceAuth" }
  | { readonly kind: "apiKey"; readonly key: string };

/**
 * Resolves a DID to its DID document.
 *
 * @remarks
 * Both of these satisfy it as they are:
 * - an `@atproto-labs/did-resolver` `DidResolver`, which returns the document;
 * - an `@atproto/oauth-client` `IdentityResolver` (`oauthClient.identityResolver`), which returns
 *   `{ did, didDoc, handle }`.
 *
 * The SDK only calls `resolve` with a `did:plc` or `did:web` DID and reads the PDS from the
 * `#atproto_pds` service of the document. It does not check that the document's `id` is the DID
 * it asked for, so the resolver is trusted to do that.
 */
export interface DidDocumentResolver {
  resolve(did: AtprotoDid): Promise<AtprotoDidDocument | { readonly didDoc: AtprotoDidDocument }>;
}

/** Options for {@link createSDKContext}. */
export interface CreateSDKContextOptions {
  /**
   * A `Client` from `@atproto/lex`. It must be authenticated for operations that write.
   *
   * @remarks
   * Sessions and `@atproto/api` agents are not accepted: wrap a session with
   * `new Client(session)` first.
   */
  client: Client;
  /**
   * Resolves a DID to its DID document. Pass `oauthClient.identityResolver` or your own resolver
   * to reuse its cache and settings; defaults to a resolver that reads `did:plc` from
   * plc.directory and `did:web` from the domain, and keeps documents in memory for up to an hour.
   *
   * @remarks
   * Used to find the PDS of another account when an operation reads a record that account owns
   * (an `{ uri }` of someone else's record). Operations on the client's own repository never
   * call it.
   *
   * The default is created per context, so every call that uses the same context shares its
   * cache, and a document is not fetched again until it expires. A new context starts with an
   * empty cache. Failed lookups are not cached. The default has no way to be pointed at another
   * PLC directory; pass a resolver for that.
   */
  didResolver?: DidDocumentResolver;
  /**
   * The Certified Group Service, needed only to write to an organization's repository with
   * `{ repo: orgDid }`. Without it such a call throws a TypeError before any request.
   *
   * @remarks
   * Each write request to the service carries a service-auth token that the SDK asks the signed-in
   * account's PDS for (`com.atproto.server.getServiceAuth`, with `aud` set to
   * `<cgs.did>#certified_group_service` and `lxm` set to the method). With OAuth, the session needs
   * one `rpc:` scope per method, because `lxm` must be a full NSID (no `prefix.*`) and `aud` must
   * carry the `#` fragment, written `%23`:
   * `rpc:app.certified.group.repo.createRecord?aud=did:web:cgs.example.com%23certified_group_service`,
   * and the same for `putRecord`, `deleteRecord` and `uploadBlob`. Repeating `lxm` in one scope
   * (`rpc?lxm=...&lxm=...&aud=...`) is equivalent. CGS accepts the token with or without the
   * fragment in `aud`. To write with an API key instead, see {@link CgsAuth} and
   * {@link ApiKeyContextOptions}.
   */
  cgs?: CgsConfig;
}

/**
 * Options for a context that writes to a group with a Certified Group Service API key (see
 * {@link CgsAuth}), with no client.
 *
 * @remarks
 * `client` is optional: reads of the group's records go to its own PDS without authentication.
 * If you pass one anyway, writes to the group still use the key, and writes without `{ repo }`
 * still go to the client's own repository.
 */
export interface ApiKeyContextOptions {
  client?: Client;
  didResolver?: DidDocumentResolver;
  cgs: CgsConfig & { readonly auth: { readonly kind: "apiKey"; readonly key: string } };
}

/**
 * Creates the shared context that SDK operations take as their first argument.
 *
 * @remarks
 * The SDK never logs in, refreshes tokens or stores sessions, and does not create its own HTTP
 * client. The application authenticates and passes in the resulting client.
 *
 * Only the shape is checked: `client` must be an `@atproto/lex` `Client` (an object with an
 * `xrpc()` method). Authentication is not checked; operations that write need an authenticated
 * client. The check is duck-typed rather than `instanceof` so it still works when the
 * application has more than one copy of `@atproto/lex`.
 *
 * `@atproto/lex` is a peer dependency. On pnpm 11 and later, installing it fails with
 * `ERR_PNPM_IGNORED_BUILDS` for `core-js` until `core-js: false` is added to `allowBuilds` in
 * `pnpm-workspace.yaml`.
 *
 * @param options - The application's client and, optionally, a DID resolver and the Certified
 * Group Service for organization writes.
 * @returns A frozen {@link SDKContext} holding `options.client` and the DID resolver.
 * @throws {@link TypeError} If `client` is missing or has no `xrpc()` method, for example a raw
 * OAuth session or an `@atproto/api` agent, or if `didResolver` is given without a `resolve()`
 * method, for example the OAuth client itself instead of `oauthClient.identityResolver`, or if
 * `cgs` is given without an http(s) `url` and a DID in `did`, or with an API key that is malformed or
 * used in a browser (`window` is defined), or if `client` is missing and `cgs.auth` is not an API key.
 *
 * @example
 * ```ts
 * import { Client } from "@atproto/lex";
 * import { createSDKContext } from "@hypercerts-org/sdk";
 *
 * // `session` comes from the application's own auth code, for example an OAuth session.
 * export const context = createSDKContext({ client: new Client(session) });
 * ```
 *
 * @example Reusing the OAuth client's resolver and its cache
 * ```ts
 * // `oauthClient` is the application's `@atproto/oauth-client` client; `session` comes from it.
 * export const context = createSDKContext({
 *   client: new Client(session),
 *   didResolver: oauthClient.identityResolver,
 * });
 * ```
 *
 * @example Writing to a group with a Certified Group Service API key, server-side, with no client
 * ```ts
 * import { createSDKContext } from "@hypercerts-org/sdk";
 * import { createRights } from "@hypercerts-org/sdk/activity";
 *
 * const context = createSDKContext({
 *   cgs: {
 *     url: "https://cgs.example.com",
 *     did: "did:web:cgs.example.com",
 *     // The `key` that `keys.create` returned, kept in the server's secrets.
 *     auth: { kind: "apiKey", key: process.env.CGS_API_KEY },
 *   },
 * });
 * await createRights(context, rights, { repo: groupDid }); // `rights`, `groupDid`: yours
 * ```
 *
 * @example Forgetting `{ repo }` with an API key throws
 * ```ts
 * await createRights(context, rights); // TypeError: pass `{ repo: groupDid }`; nothing was sent
 * ```
 *
 * @example Passing the session directly throws
 * ```ts
 * createSDKContext({ client: session }); // TypeError: wrap it with `new Client(session)`
 * ```
 */
export function createSDKContext(
  options: CreateSDKContextOptions | ApiKeyContextOptions,
): SDKContext {
  const client: unknown = options?.client;
  const cgs = options?.cgs === undefined ? undefined : checkedCgs(options.cgs);
  // A client may be left out only by a context whose group writes use a key.
  if (client !== undefined || cgs?.auth?.kind !== "apiKey") assertClient(client);
  const didResolver = options.didResolver ?? createDefaultDidResolver();
  if (!hasMethod(didResolver, "resolve")) throw notADidResolver(didResolver);
  return Object.freeze({
    ...(client === undefined ? {} : { client }),
    didResolver,
    ...(cgs === undefined ? {} : { cgs }),
  });
}

// Duck-typed instead of `instanceof Client`: an application can end up with more than one
// copy of @atproto/lex (or @atproto/lex-client, where `Client` is defined), and `instanceof`
// is false across copies. Every typed `Client` method (`create`, `get`, `uploadBlob`, ...) is
// built on `xrpc`, so it is the one method any real client has. A session or agent has no
// `xrpc` method, and the legacy `@atproto/api` agent exposes `xrpc` as an object.
function assertClient(value: unknown): asserts value is Client {
  if (hasMethod(value, "xrpc")) return;
  throw new TypeError(
    `createSDKContext: \`client\` must be an @atproto/lex Client (an object with an xrpc() method), but received ${describeValue(value)}. ` +
      "The SDK does not accept sessions or agents because authentication stays in your application. " +
      "Authenticate first, then pass `new Client(session)` (imported from @atproto/lex) as `client`.",
  );
}

// A bad CGS URL or DID would only show up as a failed request after the first records were written,
// so it is refused here.
function checkedCgs(value: unknown): CgsConfig {
  const { url, did } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const parsed = typeof url === "string" ? tryParseUrl(url) : undefined;
  if (parsed === undefined || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    throw new TypeError(
      `createSDKContext: \`cgs.url\` must be the http(s) base URL of the Certified Group Service, for example "https://cgs.example.com", but received ${describeValue(url)}.`,
    );
  }
  // Requests go to `<url>/xrpc/<method>`: a query or fragment would swallow the method. Credentials
  // are refused too, and not echoed, so they cannot leak into logs. Path prefixes stay valid.
  if (/[?#]/.test(url as string) || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(
      'createSDKContext: `cgs.url` must be a base URL without a query string, fragment or credentials, for example "https://cgs.example.com" or "https://example.com/cgs".',
    );
  }
  if (typeof did !== "string" || !isDidString(did)) {
    throw new TypeError(
      `createSDKContext: \`cgs.did\` must be the service's DID, for example "did:web:cgs.example.com", but received ${describeValue(did)}.`,
    );
  }
  const auth = checkedAuth((value as { auth?: unknown }).auth);
  return Object.freeze({
    url: parsed.href.replace(/\/$/, ""),
    did,
    ...(auth === undefined ? {} : { auth }),
  });
}

// `cgsk_<ref>.<secret>`. A malformed key is refused here, before any request, and the message never
// repeats what was given: it may be a real secret with a typo. Keys are base64url, so anything
// else is refused here: a character outside ASCII would make `Headers.set` throw a message that
// quotes it, which would put part of the secret in an error.
const API_KEY = /^cgsk_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function checkedAuth(value: unknown): CgsAuth | undefined {
  if (value === undefined) return undefined;
  const { kind, key } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  if (kind === "serviceAuth") return Object.freeze({ kind });
  if (kind !== "apiKey") {
    throw new TypeError(
      `createSDKContext: \`cgs.auth.kind\` must be "serviceAuth" or "apiKey", but received ${describeValue(kind)}.`,
    );
  }
  // An API key is a long-lived secret, and a page that holds one hands it to every visitor.
  if (typeof window !== "undefined") {
    throw new TypeError(
      "createSDKContext: an API key is a long-lived secret and must not be used in a browser, where anyone can read it. Use it only in server-side code. In the browser, sign in and pass `cgs: { url, did }` with a `client` instead.",
    );
  }
  if (typeof key !== "string" || !API_KEY.test(key)) {
    throw new TypeError(
      `createSDKContext: \`cgs.auth.key\` must be a Certified Group Service API key of the form "cgsk_<ref>.<secret>", but received ${describeValue(key)}${typeof key === "string" ? ` of ${key.length} characters that does not have that form` : ""}. Use the \`key\` that keys.create returned; it is shown only once.`,
    );
  }
  return Object.freeze({ kind, key });
}

function tryParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

// Duck-typed for the same reason as `assertClient`. The common mistake is passing the OAuth client
// itself, which has no `resolve` method; its resolver is `oauthClient.identityResolver`.
function notADidResolver(value: unknown): TypeError {
  return new TypeError(
    `createSDKContext: \`didResolver\` must be an object with a resolve(did) method, but received ${describeValue(value)}. ` +
      "Pass `oauthClient.identityResolver` or a DID resolver from @atproto-labs/did-resolver, or leave it out to use the SDK's cached default.",
  );
}

function hasMethod(value: unknown, name: string): boolean {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, name) === "function"
  );
}
