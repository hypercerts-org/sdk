import type { DidString } from "@atproto/lex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivity, createRights } from "./activity/index.js";
import { uploadBlob } from "./blob/index.js";
import { createSDKContext } from "./context.js";
import { PartialWriteError, WriteRejectedError } from "./errors.js";
import { like, unlike } from "./social/index.js";
import { CGS_DID, CGS_URL, fakeCgs, ORG } from "./test-utils/fake-cgs.js";
import { json } from "./test-utils/fake-pds.js";
import { fakeRepo } from "./test-utils/fake-repo.js";
import { png } from "./test-utils/records.js";

const repo = ORG as DidString;
const SECRET = "s3cr3tS3cr3tValue";
const KEY = `cgsk_ref123.${SECRET}`;
const ACTIVITY = "org.hypercerts.claim.activity";
const rights = {
  rightsName: "CC BY 4.0",
  rightsType: "CC-BY",
  rightsDescription: "Free to share and adapt with attribution.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// Every message and cause message an error carries, to prove the secret is in none of them.
function allMessages(error: unknown): string[] {
  const out: string[] = [];
  for (let e = error; e instanceof Error; e = e.cause) out.push(e.message);
  if (error instanceof PartialWriteError) out.push(...allMessages(error.failure));
  return out;
}

describe("writes with a CGS API key", () => {
  it("sends X-API-Key and repo on the querystring for every write, never asks a PDS for a token", async () => {
    const subject = `at://${ORG}/${ACTIVITY}/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      apiKey: KEY,
      records: {
        [subject]: {
          $type: ACTIVITY,
          title: "T",
          shortDescription: "s",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const result = await createActivity(
      cgs.context,
      { title: "Trees", shortDescription: "Planting trees", rights, image: png() },
      { repo },
    );
    const liked = await like(cgs.context, { subject: { uri: subject } }, { repo });
    await unlike(cgs.context, { like: liked }, { repo });

    expect(cgs.requests.map((request) => request.method.split(".").pop())).toEqual([
      "uploadBlob",
      "createRecord",
      "createRecord",
      "createRecord",
      "deleteRecord",
    ]);
    for (const request of cgs.requests) {
      expect(request.headers.get("x-api-key")).toBe(KEY);
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.params.repo).toBe(ORG);
    }
    expect(cgs.tokens).toEqual([]);
    expect(cgs.calls.some((call) => call.startsWith("account "))).toBe(false);
    expect(result.uri.startsWith(`at://${ORG}/${ACTIVITY}/`)).toBe(true);
  });

  it("without { repo } throws a TypeError before any request, with or without a client", async () => {
    const keyOnly = fakeCgs({ apiKey: KEY });
    const error = await createRights(keyOnly.context, rights).catch((e) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("{ repo: groupDid }");
    expect(keyOnly.requests).toEqual([]);

    // A client next to the key never turns a missing `repo` into a write to the client's PDS.
    const session = fakeRepo();
    const context = createSDKContext({
      client: session.context.client,
      cgs: { url: CGS_URL, did: CGS_DID, auth: { kind: "apiKey", key: KEY } },
    });
    const withClient = await createRights(context, rights).catch((e) => e);
    expect(withClient).toBeInstanceOf(TypeError);
    expect(session.requests).toEqual([]);
  });

  it("with a client present still writes the group through CGS with the key", async () => {
    const cgs = fakeCgs({ apiKey: KEY });
    const session = fakeRepo();
    const context = createSDKContext({
      client: session.context.client,
      cgs: { url: CGS_URL, did: CGS_DID, auth: { kind: "apiKey", key: KEY } },
      didResolver: cgs.context.didResolver,
    });

    await createRights(context, rights, { repo });

    expect(cgs.of("createRecord")[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(session.requests).toEqual([]);
  });
});

describe("a CGS refusal of an API key", () => {
  const refuse = (status: number, error: string, message: string) =>
    fakeCgs({ apiKey: KEY, answer: () => json(status, { error, message }) });

  it("401 names the key, not the secret: unknown, revoked or another group", async () => {
    const cgs = refuse(401, "AuthRequired", "Invalid API key");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.status).toBe(401);
    expect(error.message).toContain("cgsk_ref123");
    expect(error.message).toMatch(/unknown, revoked, or belongs to another group/);
    expect(error.message).toContain("Nothing was written");
  });

  it("403 for a missing scope says which scope to add", async () => {
    const cgs = refuse(403, "Forbidden", "API key scopes do not permit 'createRecord'");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.status).toBe(403);
    expect(error.message).toContain("repo:org.hypercerts.claim.rights?action=create");
  });

  it("403 for the member's role says that a key never exceeds the member's role", async () => {
    const cgs = refuse(403, "Forbidden", "Role 'member' cannot perform 'putRecord'");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.message).toContain("never exceeds its member's current role");
    expect(error.message).not.toContain("scope for this write");
  });

  it("403 with wording the SDK does not know names both possible causes", async () => {
    const cgs = refuse(403, "Forbidden", "Something new");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);

    expect(error.message).toContain(
      "lacks the scope repo:org.hypercerts.claim.rights?action=create",
    );
    expect(error.message).toContain("member's role");
  });

  it("403 for a removed member says the key's member is gone", async () => {
    const cgs = refuse(403, "Forbidden", "Not a member of this group");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.message).toContain("no longer a member");
  });

  it("403 on an upload names the blob scope", async () => {
    const cgs = refuse(403, "Forbidden", "API key scopes do not permit 'uploadBlob'");

    const error = await uploadBlob(cgs.context, png(), { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.message).toContain("blob:image/png");
  });

  it("403 on a later record is the failure of a PartialWriteError that lists what landed", async () => {
    const cgs = fakeCgs({
      apiKey: KEY,
      answer: (request) =>
        request.body?.collection === ACTIVITY
          ? json(403, {
              error: "Forbidden",
              message: "API key scopes do not permit 'createRecord'",
            })
          : undefined,
    });

    const error = await createActivity(
      cgs.context,
      { title: "Trees", shortDescription: "Planting trees", rights },
      { repo },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error.written).toHaveLength(1);
    expect(error.failure).toBeInstanceOf(WriteRejectedError);
    expect(error.failure.message).toContain(`repo:${ACTIVITY}?action=create`);
  });

  // The 401 and 403 cases above assert their own messages; a 500 is the one answer they never read.
  it("never puts the secret in a message or a cause, for a 500 on a write or an upload", async () => {
    const cgs = refuse(500, "InternalServerError", "boom");

    const error = await createRights(cgs.context, rights, { repo }).catch((e) => e);
    const upload = await uploadBlob(cgs.context, png(), { repo }).catch((e) => e);

    for (const caught of [error, upload]) {
      expect(caught).toBeInstanceOf(Error);
      for (const message of allMessages(caught)) expect(message).not.toContain(SECRET);
    }
  });
});
