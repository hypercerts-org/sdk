import { currentDatetimeString } from "@atproto/lex";
import * as rightsLexicon from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRights } from "../src/activity/index.js";
import { createSDKContext } from "../src/index.js";
import { createBuildContext } from "../src/internal/build-context.js";
import { cgsTarget } from "../src/internal/cgs-target.js";
import { prepareRecord } from "../src/internal/prepare-record.js";
import { rights, unique } from "./fixtures.js";
import { collections, expectStored } from "./records.js";
import { type Account, loginAs } from "./session.js";

// The sandbox has no Certified Group Service. These tests cover what the SDK asks of the real
// PDS for an organization write: the service-auth token. A stand-in for the CGS host answers the
// requests that the SDK sends to it and keeps the tokens it received.
const CGS = { url: "https://cgs.invalid", did: "did:web:cgs.invalid" } as const;

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString());
}

describe("organization writes: service-auth token", () => {
  it("gets a token from the account's PDS for the CGS audience and the method", async () => {
    const tokens: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== CGS.url) return realFetch(input, init);
      tokens.push(request.headers.get("authorization")?.replace("Bearer ", "") ?? "");
      const body = (await request.json()) as { repo: string; collection: string; rkey: string };
      return Response.json({
        uri: `at://${body.repo}/${body.collection}/${body.rkey}`,
        cid: record.ref.cid,
      });
    });
    const context = createSDKContext({ client: user.client, cgs: CGS });
    const record = await prepareRecord(user.did, rightsLexicon.main, {
      ...rights,
      rightsName: unique("Rights"),
      createdAt: currentDatetimeString(),
    });

    await cgsTarget(context, CGS, user.did, "e2e").submit({
      creates: [record],
      updates: [],
      createOnly: false,
    });

    expect(tokens).toHaveLength(1);
    expect(claims(tokens[0] as string)).toMatchObject({
      iss: user.did,
      aud: `${CGS.did}#certified_group_service`,
      lxm: "app.certified.group.repo.createRecord",
    });
  });
});

describe("{ repo: ownDid }", () => {
  it("writes to the account's own PDS, with no CGS configured", async () => {
    const context = createSDKContext({ client: user.client });
    expect(createBuildContext(context, "e2e", { repo: user.did }).target.atomic).toBe(true);

    const ref = await createRights(
      context,
      { ...rights, rightsName: unique("Rights") },
      { repo: user.did },
    );

    expect(ref.uri).toMatch(new RegExp(`^at://${user.did}/${collections.rights}/`));
    await expectStored(user.client, ref);
  });
});
