// The SDK's own tsconfig has no Node types (`types: []`); only this test needs `util`.
// @ts-expect-error TS2591: no @types/node in this package.
import { inspect } from "node:util";
import { Client } from "@atproto/lex";
import { createDidResolver, type DidResolver, DidResolverCommon } from "@atproto-labs/did-resolver";
import type { IdentityResolver } from "@atproto-labs/identity-resolver";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("keeps a validated cgs, with a trailing slash removed from its URL", () => {
    const context = createSDKContext({
      client,
      cgs: { url: "https://cgs.example.test/", did: "did:web:cgs.example.test" },
    });

    expect(context.cgs).toEqual({
      url: "https://cgs.example.test",
      did: "did:web:cgs.example.test",
      auth: { kind: "serviceAuth" },
    });
  });

  it("keeps a path prefix in the cgs URL", () => {
    const context = createSDKContext({
      client,
      cgs: { url: "https://example.test/cgs/", did: "did:web:cgs.example.test" },
    });

    expect(context.cgs?.url).toBe("https://example.test/cgs");
  });

  it("defaults cgs.did to did:web:<hostname of cgs.url>, dropping a port", () => {
    expect(createSDKContext({ client, cgs: { url: "https://cgs.example.test" } }).cgs?.did).toBe(
      "did:web:cgs.example.test",
    );
    expect(createSDKContext({ client, cgs: { url: "http://localhost:3000/base/" } }).cgs?.did).toBe(
      "did:web:localhost",
    );
  });

  it("uses an explicit cgs.did over the default", () => {
    const cgs = { url: "https://cgs.example.test", did: "did:web:custom.example" } as const;

    expect(createSDKContext({ client, cgs }).cgs?.did).toBe("did:web:custom.example");
  });

  it("has no cgs unless one is given", () => {
    expect(createSDKContext({ client }).cgs).toBeUndefined();
  });

  it.each([
    ["a URL that is not http(s)", { url: "ftp://cgs.test", did: "did:web:cgs.test" }, "cgs.url"],
    ["a URL that does not parse", { url: "cgs.test", did: "did:web:cgs.test" }, "cgs.url"],
    ["a handle as the DID", { url: "https://cgs.test", did: "cgs.test" }, "cgs.did"],
    [
      "a DID with a service fragment",
      { url: "https://cgs.test", did: "did:web:cgs.test#certified_group_service" },
      "cgs.did",
    ],
    ["no URL", { did: "did:web:cgs.test" }, "cgs.url"],
    [
      "a URL with a query",
      { url: "https://cgs.test?region=us", did: "did:web:cgs.test" },
      "cgs.url",
    ],
    [
      "a URL with an empty query",
      { url: "https://cgs.test/?", did: "did:web:cgs.test" },
      "cgs.url",
    ],
    ["a URL with a fragment", { url: "https://cgs.test/#x", did: "did:web:cgs.test" }, "cgs.url"],
    ["a URL with credentials", { url: "https://u:p@cgs.test", did: "did:web:cgs.test" }, "cgs.url"],
  ])("throws a TypeError for cgs with %s", (_name, cgs, field) => {
    // @ts-expect-error The point is to reject what the types already forbid.
    expect(() => createSDKContext({ client, cgs })).toThrow(new RegExp(`\\\`${field}\\\``));
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

describe("createSDKContext with a CGS API key", () => {
  const cgs = { url: "https://cgs.test", did: "did:web:cgs.test" } as const;
  const key = "cgsk_ref123.s3cr3tValue";
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("needs no client and keeps the key frozen on cgs.auth", () => {
    const context = createSDKContext({ cgs: { ...cgs, auth: { kind: "apiKey", key } } });

    expect(context.client).toBeUndefined();
    expect(context.cgs?.auth).toMatchObject({ kind: "apiKey", key });
    expect(Object.isFrozen(context.cgs?.auth)).toBe(true);
  });

  it("does not show the key through JSON.stringify or util.inspect", () => {
    const context = createSDKContext({ cgs: { ...cgs, auth: { kind: "apiKey", key } } });

    for (const text of [
      JSON.stringify(context),
      inspect(context, { depth: 10 }),
      inspect(context.cgs?.auth),
    ]) {
      expect(text).not.toContain("s3cr3tValue");
      expect(text).toContain("cgsk_ref123.***");
    }
  });

  it("defaults to service auth and accepts it explicitly", () => {
    expect(createSDKContext({ client, cgs }).cgs?.auth).toEqual({ kind: "serviceAuth" });
    expect(
      createSDKContext({ client, cgs: { ...cgs, auth: { kind: "serviceAuth" } } }).cgs?.auth,
    ).toEqual({ kind: "serviceAuth" });
  });

  it("still needs a client when the auth is not a key", () => {
    // @ts-expect-error `client` is optional only with an API key.
    expect(() => createSDKContext({ cgs })).toThrow(/client/);
    // @ts-expect-error Same with explicit service auth.
    expect(() => createSDKContext({ cgs: { ...cgs, auth: { kind: "serviceAuth" } } })).toThrow(
      /client/,
    );
  });

  it.each([
    ["no prefix", "ref123.secret"],
    ["no dot", "cgsk_ref123secret"],
    ["no secret", "cgsk_ref123."],
    ["no ref", "cgsk_.secret"],
    ["whitespace", "cgsk_ref123.sec ret"],
    ["a non-ASCII character", "cgsk_ref123.s3cr€tValue"],
  ])("rejects a key with %s without repeating it", (_name, bad) => {
    const attempt = () => createSDKContext({ cgs: { ...cgs, auth: { kind: "apiKey", key: bad } } });

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(/cgsk_<ref>\.<secret>/);
    expect(attempt).not.toThrow(new RegExp(bad.replace(".", "\\.")));
  });

  it("refuses a key in a browser", () => {
    vi.stubGlobal("window", {});

    expect(() => createSDKContext({ cgs: { ...cgs, auth: { kind: "apiKey", key } } })).toThrow(
      /must not be used in a browser/,
    );
  });
});
