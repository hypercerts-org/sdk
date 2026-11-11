import type { Client } from "@atproto/lex";
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
  /** The application's `@atproto/lex` client. Operations send all their requests through it. */
  readonly client: Client;
  /**
   * Finds the DID document of an account other than the client's, to locate its PDS. The
   * resolver passed to {@link createSDKContext}, or the SDK's cached default.
   */
  readonly didResolver: DidDocumentResolver;
}

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
 * @param options - The application's client and, optionally, a DID resolver.
 * @returns A frozen {@link SDKContext} holding `options.client` and the DID resolver.
 * @throws {@link TypeError} If `client` is missing or has no `xrpc()` method, for example a raw
 * OAuth session or an `@atproto/api` agent, or if `didResolver` is given without a `resolve()`
 * method, for example the OAuth client itself instead of `oauthClient.identityResolver`.
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
 * @example Passing the session directly throws
 * ```ts
 * createSDKContext({ client: session }); // TypeError: wrap it with `new Client(session)`
 * ```
 */
export function createSDKContext(options: CreateSDKContextOptions): SDKContext {
  const client: unknown = options?.client;
  assertClient(client);
  const didResolver = options.didResolver ?? createDefaultDidResolver();
  if (!hasMethod(didResolver, "resolve")) throw notADidResolver(didResolver);
  return Object.freeze({ client, didResolver });
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
