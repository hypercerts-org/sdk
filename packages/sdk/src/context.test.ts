import { Client } from "@atproto/lex";
import { createDidResolver, type DidResolver, DidResolverCommon } from "@atproto-labs/did-resolver";
import type { IdentityResolver } from "@atproto-labs/identity-resolver";
import { describe, expect, it } from "vitest";
import { createSDKContext } from "./context.js";

const client = new Client({ service: "https://pds.example.test" });

describe("createSDKContext", () => {
  it("retains the client it was given", () => {
    const context = createSDKContext({ client });

    expect(context.client).toBe(client);
  });

  it("returns a frozen context", () => {
    const context = createSDKContext({ client });

    expect(Object.isFrozen(context)).toBe(true);
  });

  it("recognises a client by its xrpc() method, not by instanceof", () => {
    // A second installed copy of @atproto/lex defines its own `Client` class, so `instanceof` fails.
    const foreignClient = { xrpc: () => Promise.resolve() };

    // @ts-expect-error A structural lookalike is not assignable to the nominal `Client` type.
    const context = createSDKContext({ client: foreignClient });

    expect(context.client).toBe(foreignClient);
  });

  it.each([
    ["no options", undefined],
    ["no client", {}],
    ["a null client", { client: null }],
    [
      "an OAuth-session-like object",
      { client: { did: "did:plc:example", fetchHandler: () => undefined } },
    ],
    ["a legacy @atproto/api agent, whose `xrpc` is an object", { client: { xrpc: {} } }],
  ] satisfies Array<[string, unknown]>)(
    "rejects %s with a message that says how to fix it",
    (_, options) => {
      // @ts-expect-error The options are deliberately not `CreateSDKContextOptions`.
      const create = () => createSDKContext(options);

      expect(create).toThrow(TypeError);
      expect(create).toThrow(/must be an @atproto\/lex Client/);
      expect(create).toThrow(/new Client\(session\)/);
    },
  );

  it("accepts a DidResolver or an oauth client's IdentityResolver as they are", () => {
    // These assignments are the test: they fail to compile if either type stops fitting.
    const didResolvers: DidResolver<"plc" | "web">[] = [
      new DidResolverCommon(),
      createDidResolver({}),
    ];
    const identityResolver: IdentityResolver = {
      resolve: () => Promise.reject(new Error("not called")),
    };

    for (const didResolver of [...didResolvers, identityResolver]) {
      expect(createSDKContext({ client, didResolver }).didResolver).toBe(didResolver);
    }
  });

  it.each([
    ["the oauth client instead of its identityResolver", { identityResolver: { resolve() {} } }],
    ["a function", () => undefined],
  ])(
    "rejects a didResolver that is %s with a message that says how to fix it",
    (_, didResolver) => {
      // @ts-expect-error Deliberately not a `DidDocumentResolver`.
      const create = () => createSDKContext({ client, didResolver });

      expect(create).toThrow(TypeError);
      expect(create).toThrow(/`didResolver` must be an object with a resolve\(did\) method/);
      expect(create).toThrow(/oauthClient\.identityResolver/);
    },
  );
});
