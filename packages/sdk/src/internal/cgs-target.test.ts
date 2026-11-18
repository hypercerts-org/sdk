import type { DidString, NsidString, RecordKeyString } from "@atproto/lex";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PartialWriteError,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
import { CGS_AUD, type CgsRequest, fakeCgs, ORG } from "../test-utils/fake-cgs.js";
import { DID, json } from "../test-utils/fake-pds.js";
import { HEAD } from "../test-utils/fake-repo.js";
import { createBuildContext } from "./build-context.js";
import { cgsTarget } from "./cgs-target.js";
import { type PreparedRecord, prepareRecord } from "./prepare-record.js";

const CREATE = "app.certified.group.repo.createRecord";
const PUT = "app.certified.group.repo.putRecord";

afterEach(() => {
  vi.unstubAllGlobals();
});

let counter = 0;
// A rights record in the org repo with a distinct key and value.
async function rec(name = `Rights ${counter++}`, rkey?: string): Promise<PreparedRecord> {
  return prepareRecord(
    ORG as DidString,
    rights.main,
    {
      rightsName: name,
      rightsType: "CC-BY",
      rightsDescription: "Share with credit",
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    rkey as RecordKeyString | undefined,
  );
}

function target(cgs: ReturnType<typeof fakeCgs>) {
  return cgsTarget(cgs.context, cgs.context.cgs as never, ORG as DidString, "op");
}

describe("cgsTarget routing", () => {
  it("is not atomic and names the org repo", () => {
    const t = target(fakeCgs());
    expect(t.atomic).toBe(false);
    expect(t.did).toBe(ORG);
  });

  it("writes to the account's own PDS, never CGS, when repo is absent or the account's own DID", async () => {
    const cgs = fakeCgs();
    for (const options of [undefined, { repo: DID as DidString }]) {
      const { target: own } = createBuildContext(cgs.context, "op", options);
      expect(own.atomic).toBe(true);
      expect(own.did).toBe(DID);
    }
    expect(cgs.requests).toEqual([]);
  });

  it("throws a TypeError before any request when the context has no cgs", () => {
    const { context } = fakeCgs();
    const bare = { ...context, cgs: undefined };

    expect(() => createBuildContext(bare, "op", { repo: ORG as DidString })).toThrow(
      /context has no `cgs`.*Nothing was sent/,
    );
    expect(() => createBuildContext(context, "op", { repo: "alice.test" as DidString })).toThrow(
      TypeError,
    );
  });
});

describe("cgsTarget.submit", () => {
  it("sends creates then updates, one request each in plan order, each with its own fresh token", async () => {
    const existing = await rec("Old", "2222222222222");
    const cgs = fakeCgs({ records: { [existing.ref.uri]: existing.value } });
    const [a, b, updated] = [await rec("A"), await rec("B"), await rec("New", "2222222222222")];

    await target(cgs).submit({
      creates: [a, b],
      updates: [{ record: updated, swapRecord: existing.ref.cid, noun: "Rights" }],
      createOnly: false,
      swapCommit: HEAD,
    });

    expect(cgs.requests.map((r) => [r.method, r.body?.rkey])).toEqual([
      [CREATE, a.rkey],
      [CREATE, b.rkey],
      [PUT, "2222222222222"],
    ]);
    // createRecord always carries the rkey; an update carries swapRecord; nothing carries swapCommit.
    expect(cgs.requests[2]?.body).toMatchObject({ repo: ORG, swapRecord: existing.ref.cid });
    expect(cgs.requests.every((r) => r.body?.swapCommit === undefined)).toBe(true);
    // One token per request, for the CGS audience and that request's own method, none reused.
    expect(cgs.tokens.map(({ aud, lxm }) => [aud, lxm])).toEqual([
      [CGS_AUD, CREATE],
      [CGS_AUD, CREATE],
      [CGS_AUD, PUT],
    ]);
    expect(new Set(cgs.tokens.map((t) => t.jti)).size).toBe(3);
    expect(cgs.store.get(updated.ref.uri)?.cid).toBe(updated.ref.cid);
  });

  it("alternates token and request, so a token is never held across requests", async () => {
    const cgs = fakeCgs();
    await target(cgs).submit({
      creates: [await rec(), await rec()],
      updates: [],
      createOnly: false,
    });

    expect(cgs.calls).toEqual([
      "account com.atproto.server.getServiceAuth",
      `cgs ${CREATE}`,
      "account com.atproto.server.getServiceAuth",
      `cgs ${CREATE}`,
    ]);
  });

  it("throws the failure itself when the first write fails and nothing landed", async () => {
    const cgs = fakeCgs({
      answer: () => json(403, { error: "Forbidden", message: "not a member" }),
    });

    const error = await target(cgs)
      .submit({ creates: [await rec(), await rec()], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).not.toBeInstanceOf(PartialWriteError);
    expect(error.status).toBe(403);
    expect(cgs.requests).toHaveLength(1);
  });

  it("throws PartialWriteError with what landed, what failed and what was never sent", async () => {
    const cgs = fakeCgs({
      answer: (_request, index) =>
        index === 1 ? json(400, { error: "InvalidRequest", message: "bad record" }) : undefined,
    });
    const [a, b, c] = [await rec("A"), await rec("B"), await rec("C")];

    const error = await target(cgs)
      .submit({ creates: [a, b, c], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error.written).toEqual([a.ref]);
    expect(error.failed).toEqual(b.ref);
    expect(error.notAttempted).toEqual([c.ref]);
    expect(error.attempted).toEqual([a.ref, b.ref, c.ref]);
    expect(error.failure).toBeInstanceOf(WriteRejectedError);
    expect(error.failure.status).toBe(400);
    expect(error.cause).toBe(error.failure);
    expect(error.message).toContain(a.ref.uri);
    expect(error.message).toContain("bad record");
    // Single-request advice from the failed step would contradict a partial write.
    expect(error.message).not.toContain("nothing was written");
    expect(error.message).not.toContain("Nothing needs cleaning up");
    expect(error.message).not.toContain("and call again.");
    // Stopped at the failure: the third was never sent.
    expect(cgs.requests).toHaveLength(2);
  });

  it("fails an update whose swapRecord is stale as 'the record changed', after the creates landed", async () => {
    const existing = await rec("Old", "2222222222222");
    const cgs = fakeCgs({ records: { [existing.ref.uri]: existing.value } });
    const created = await rec("A");
    const updated = await rec("New", "2222222222222");

    const error = await target(cgs)
      .submit({
        creates: [created],
        updates: [{ record: updated, swapRecord: created.ref.cid, noun: "Collection" }],
        createOnly: false,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error.written).toEqual([created.ref]);
    expect(error.failure.code).toBe("InvalidSwap");
    expect(error.failure.message).toContain("the Collection changed since it was read");
    // The existing record is untouched.
    expect(cgs.store.get(existing.ref.uri)?.cid).toBe(existing.ref.cid);
  });

  it("throws a plain Error and sends nothing when the account's PDS refuses a service-auth token", async () => {
    const cgs = fakeCgs({
      refuseServiceAuth: () => json(400, { error: "InvalidRequest", message: "no scope" }),
    });

    const error = await target(cgs)
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).not.toBeInstanceOf(WriteRejectedError);
    expect(error.message).toContain("cannot get a service-auth token");
    expect(error.message).toContain(`rpc:${CREATE}?aud=did:web:cgs.test%23certified_group_service`);
    expect(cgs.requests).toEqual([]);
  });

  it("wraps a service-auth failure after the first record in PartialWriteError", async () => {
    const cgs = fakeCgs({
      refuseServiceAuth: (index) =>
        index === 1 ? json(400, { error: "InvalidRequest", message: "no scope" }) : undefined,
    });
    const [a, b] = [await rec(), await rec()];

    const error = await target(cgs)
      .submit({ creates: [a, b], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error.written).toEqual([a.ref]);
    expect(error.failed).toEqual(b.ref);
    expect(error.failure.message).toContain("cannot get a service-auth token");
    expect(cgs.requests).toHaveLength(1);
  });

  it("reports a CID the service did not compute as WriteResultMismatchError", async () => {
    const cgs = fakeCgs({
      answer: (request) =>
        json(200, {
          uri: `at://${ORG}/${request.body?.collection}/${request.body?.rkey}`,
          cid: "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
        }),
    });

    const error = await target(cgs)
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteResultMismatchError);
  });
});

describe("cgsTarget error wording", () => {
  it("names the Certified Group Service, not the PDS, when CGS rejects or does not answer", async () => {
    const rejecting = fakeCgs({ answer: () => json(403, { error: "Forbidden", message: "no" }) });
    const rejected = await target(rejecting)
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);
    expect(rejected).toBeInstanceOf(WriteRejectedError);
    expect(rejected.message).toContain("the Certified Group Service rejected the request");
    expect(rejected.message).not.toContain("the PDS");

    const silent = fakeCgs({ answer: () => json(500, { error: "InternalServerError" }) });
    const unknown = await target(silent)
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);
    expect(unknown).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(unknown.message).toContain("no usable answer from the Certified Group Service");
    expect(unknown.message).not.toContain("the PDS");
  });

  it("names the Certified Group Service when a delete is rejected", async () => {
    const cgs = fakeCgs({ answer: () => json(400, { error: "InvalidRequest", message: "no" }) });
    const error = await target(cgs)
      .delete({ uri: `at://${ORG}/org.hypercerts.claim.rights/3k` as never, cid: undefined })
      .catch((e) => e);
    expect(error.message).toContain("the Certified Group Service rejected the request");
  });
});

describe("cgsTarget create read-back", () => {
  // CGS answers a taken key with 502, the same as a server fault: the record decides.
  const bad = () => json(502, { error: "UpstreamFailure", message: "upstream request failed" });

  it("treats the same CID at the key as written, and carries on", async () => {
    const [a, b] = [await rec("A"), await rec("B")];
    const cgs = fakeCgs({
      records: { [a.ref.uri]: a.value },
      answer: (request) => (request.body?.rkey === a.rkey ? bad() : undefined),
    });

    await target(cgs).submit({ creates: [a, b], updates: [], createOnly: false });

    expect(cgs.requests).toHaveLength(2);
    expect(cgs.calls.filter((call) => call.startsWith("org"))).toEqual([
      "org com.atproto.repo.getRecord",
    ]);
  });

  it("throws RecordAlreadyExistsError when another record has the key", async () => {
    const mine = await rec("Mine", "3333333333333");
    const theirs = await rec("Theirs", "3333333333333");
    const cgs = fakeCgs({ records: { [theirs.ref.uri]: theirs.value } });

    const error = await target(cgs)
      .submit({ creates: [mine], updates: [], createOnly: true })
      .catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error.uri).toBe(mine.ref.uri);
    expect(error.attempted).toEqual([mine.ref]);
    // The existing record is untouched.
    expect(cgs.store.get(mine.ref.uri)?.cid).toBe(theirs.ref.cid);
  });

  it("throws WriteOutcomeUnknownError when the record is absent", async () => {
    const cgs = fakeCgs({ answer: bad });

    const error = await target(cgs)
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
  });

  it("keeps the unknown outcome when the read-back itself fails", async () => {
    const cgs = fakeCgs({ answer: bad });
    const unreachable = {
      ...cgs.context,
      didResolver: { resolve: () => Promise.reject(new Error("no")) },
    };

    const error = await cgsTarget(unreachable, cgs.context.cgs as never, ORG as DidString, "op")
      .submit({ creates: [await rec()], updates: [], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
  });

  it("does not read an update back: its outcome stays unknown", async () => {
    const existing = await rec("Old", "2222222222222");
    const cgs = fakeCgs({ records: { [existing.ref.uri]: existing.value }, answer: bad });

    const error = await target(cgs)
      .submit({ creates: [], updates: [{ record: existing }], createOnly: false })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(cgs.calls.some((call) => call.startsWith("org"))).toBe(false);
  });
});

describe("cgsTarget.delete", () => {
  it("sends swapRecord when a CID is given, and deletes", async () => {
    const r = await rec();
    const cgs = fakeCgs({ records: { [uriOf(r)]: r.value } });

    await target(cgs).delete({ uri: uriOf(r), cid: r.ref.cid });

    expect(cgs.of("deleteRecord")[0]?.body).toMatchObject({
      repo: ORG,
      collection: rights.$nsid,
      rkey: r.rkey,
      swapRecord: r.ref.cid,
    });
    expect(cgs.store.has(uriOf(r))).toBe(false);
  });

  it("refuses a stale CID and deletes nothing", async () => {
    const r = await rec();
    const other = await rec();
    const cgs = fakeCgs({ records: { [uriOf(r)]: r.value } });

    const error = await target(cgs)
      .delete({ uri: uriOf(r), cid: other.ref.cid })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.code).toBe("InvalidSwap");
    expect(cgs.store.has(uriOf(r))).toBe(true);
  });

  it("treats a member's 403 on a record that is already gone as success", async () => {
    const r = await rec();
    const cgs = fakeCgs({ memberDeletes: true });

    await expect(target(cgs).delete({ uri: uriOf(r), cid: r.ref.cid })).resolves.toBeUndefined();
    expect(cgs.calls.filter((call) => call.startsWith("org"))).toEqual([
      "org com.atproto.repo.getRecord",
    ]);
  });

  it("keeps the 403 when the record still exists", async () => {
    const r = await rec();
    const cgs = fakeCgs({
      records: { [uriOf(r)]: r.value },
      answer: () => json(403, { error: "Forbidden", message: "requires admin" }),
    });

    const error = await target(cgs)
      .delete({ uri: uriOf(r) })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.status).toBe(403);
  });
});

describe("cgsTarget reads and blobs", () => {
  it("reads the head and records from the org's own PDS, never through CGS or the account's PDS", async () => {
    const r = await rec();
    const cgs = fakeCgs({ records: { [uriOf(r)]: r.value } });
    const t = target(cgs);

    await expect(t.readHead()).resolves.toBe(HEAD);
    await expect(t.recordExists(rights.$nsid as NsidString, r.rkey)).resolves.toEqual(r.ref);
    await expect(
      t.recordExists(rights.$nsid as NsidString, "4444444444444" as RecordKeyString),
    ).resolves.toBeUndefined();

    expect(cgs.requests).toEqual([]);
    expect(cgs.calls.every((call) => call.startsWith("org"))).toBe(true);
  });

  it("uploads through CGS with the org on the querystring and a token for uploadBlob", async () => {
    const cgs = fakeCgs();

    const blob = await target(cgs).uploadBlob(new Blob([new Uint8Array([1, 2, 3])]), "image/png");

    const [request] = cgs.requests as [CgsRequest];
    expect(request.method).toBe("app.certified.group.repo.uploadBlob");
    expect(request.params).toEqual({ repo: ORG });
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(cgs.tokens[0]?.lxm).toBe("app.certified.group.repo.uploadBlob");
    expect(blob.mimeType).toBe("image/png");
    expect(blob.size).toBe(3);
  });
});

function uriOf(r: PreparedRecord) {
  return r.ref.uri;
}
