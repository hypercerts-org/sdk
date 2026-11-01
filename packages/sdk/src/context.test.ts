import { Client } from "@atproto/lex";
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
});
