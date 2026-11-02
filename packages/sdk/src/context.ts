import type { Client } from "@atproto/lex";
import { describeValue } from "./internal/describe.js";

/**
 * Shared context passed as the first argument to every SDK operation.
 *
 * @remarks
 * Create it once with {@link createSDKContext} and reuse it for every call. It is frozen and
 * holds only the application's client: no session, credentials or HTTP client of its own.
 * Create a new context when the application replaces its client, for example after signing in
 * as another account.
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
 * @param options - The application's client.
 * @returns A frozen {@link SDKContext} holding `options.client`.
 * @throws {@link TypeError} If `client` is missing or has no `xrpc()` method, for example a raw
 * OAuth session or an `@atproto/api` agent.
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
 * @example Passing the session directly throws
 * ```ts
 * createSDKContext({ client: session }); // TypeError: wrap it with `new Client(session)`
 * ```
 */
export function createSDKContext(options: CreateSDKContextOptions): SDKContext {
  const client: unknown = options?.client;
  assertClient(client);
  return Object.freeze({ client });
}

// Duck-typed instead of `instanceof Client`: an application can end up with more than one
// copy of @atproto/lex (or @atproto/lex-client, where `Client` is defined), and `instanceof`
// is false across copies. Every typed `Client` method (`create`, `get`, `uploadBlob`, ...) is
// built on `xrpc`, so it is the one method any real client has. A session or agent has no
// `xrpc` method, and the legacy `@atproto/api` agent exposes `xrpc` as an object.
function assertClient(value: unknown): asserts value is Client {
  const hasXrpcMethod =
    typeof value === "object" &&
    value !== null &&
    "xrpc" in value &&
    typeof value.xrpc === "function";
  if (hasXrpcMethod) return;
  throw new TypeError(
    `createSDKContext: \`client\` must be an @atproto/lex Client (an object with an xrpc() method), but received ${describeValue(value)}. ` +
      "The SDK does not accept sessions or agents because authentication stays in your application. " +
      "Authenticate first, then pass `new Client(session)` (imported from @atproto/lex) as `client`.",
  );
}
