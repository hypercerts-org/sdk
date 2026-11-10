import * as profile from "@hypercerts-org/lexicon/app/certified/actor/profile";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, HEAD, methods } from "../test-utils/fake-repo.js";
import { prepareRecord, prepareUpdate } from "./prepare-record.js";
import {
  submitCreateOnly,
  submitWrites,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "./submit-writes.js";

async function prepared() {
  return prepareRecord(DID, rights.main, {
    rightsName: "CC BY",
    rightsType: "CC-BY",
    rightsDescription: "Share with credit",
    createdAt: "2024-01-01T00:00:00.000Z",
  });
}

// A rights record that already exists at `rkey`, with a new description.
async function updated() {
  return prepareUpdate(
    DID,
    rights.main,
    {
      rightsName: "CC BY",
      rightsType: "CC-BY",
      rightsDescription: "Share with credit and a link",
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    "3k2a4b5c6d7e8",
  );
}

describe("submitWrites", () => {
  it("treats an HTTP 4xx as a definite rejection", async () => {
    const { context } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "no" }),
    });
    const record = await prepared();

    const error = await submitWrites(context, DID, [record], "op").catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ status: 400, code: "InvalidRequest", attempted: [record.ref] });
  });

  it.each([
    ["HTTP 408", () => json(408, { error: "RequestTimeout", message: "slow" })],
    ["HTTP 500", () => json(500, { error: "InternalServerError", message: "boom" })],
    ["an unreadable 2xx body", () => new Response("not json", { status: 200 })],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("treats %s as an unknown outcome", async (_, applyWrites) => {
    const { context, requests } = fakeRepo({ applyWrites });
    const record = await prepared();

    const error = await submitWrites(context, DID, [record], "op").catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.attempted).toEqual([record.ref]);
    expect(error.message).toContain(record.ref.uri);
    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });

  it("accepts a PDS that omits the results", async () => {
    const { context } = fakeRepo({ applyWrites: () => json(200, {}) });

    await expect(submitWrites(context, DID, [await prepared()], "op")).resolves.toBeUndefined();
  });

  it("reports results that differ from the computed references", async () => {
    const record = await prepared();
    const { context } = fakeRepo({
      applyWrites: () =>
        json(200, {
          results: [
            { $type: "com.atproto.repo.applyWrites#createResult", uri: record.ref.uri, cid: CID },
          ],
        }),
    });

    const error = await submitWrites(context, DID, [record], "op").catch((e) => e);

    expect(error).toBeInstanceOf(WriteResultMismatchError);
    expect(error.reported).toEqual([{ uri: record.ref.uri, cid: CID }]);
  });

  describe("with an update", () => {
    it("applies the update after the creates in one request, conditional on the head", async () => {
      const { context, requests, creates, updates, swapCommits } = fakeRepo();
      const [created, update] = [await prepared(), await updated()];

      await submitWrites(context, DID, [created], "op", { updates: [update], swapCommit: HEAD });

      expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
      expect(creates[0]?.map((write) => write.rkey)).toEqual([created.rkey]);
      expect(updates[0]?.map((write) => [write.rkey, write.cid])).toEqual([
        [update.rkey, update.ref.cid],
      ]);
      expect(swapCommits).toEqual([HEAD]);
    });

    it("reports a CID for the updated record that differs from the computed one", async () => {
      const [created, update] = [await prepared(), await updated()];
      const { context } = fakeRepo({
        applyWrites: () =>
          json(200, {
            results: [
              { $type: "com.atproto.repo.applyWrites#createResult", ...created.ref },
              { $type: "com.atproto.repo.applyWrites#updateResult", uri: update.ref.uri, cid: CID },
            ],
          }),
      });

      const error = await submitWrites(context, DID, [created], "op", {
        updates: [update],
      }).catch((e) => e);

      expect(error).toBeInstanceOf(WriteResultMismatchError);
      expect(error.attempted).toEqual([created.ref, update.ref]);
      expect(error.message).toMatch(/applied the writes/);
    });

    it("says the update was not changed when the PDS rejects the request", async () => {
      const { context } = fakeRepo({
        applyWrites: () => json(400, { error: "InvalidRequest", message: "no" }),
      });
      const update = await updated();

      const error = await submitWrites(context, DID, [await prepared()], "op", {
        updates: [update],
      }).catch((e) => e);

      expect(error).toBeInstanceOf(WriteRejectedError);
      expect(error.message).toContain(
        `the new record was not created and ${update.ref.uri} was not changed`,
      );
    });

    it("explains InvalidSwap only when the request was conditional on a commit", async () => {
      const { context } = fakeRepo({
        applyWrites: () => json(400, { error: "InvalidSwap", message: "Commit was at x" }),
      });
      const options = { updates: [await updated()] };

      const conditional = await submitWrites(context, DID, [], "op", {
        ...options,
        swapCommit: HEAD,
      }).catch((e) => e);
      const unconditional = await submitWrites(context, DID, [], "op", options).catch((e) => e);

      expect(conditional).toMatchObject({ code: "InvalidSwap" });
      expect(conditional.message).toMatch(/the repository changed since it was read/);
      expect(unconditional).toMatchObject({ code: "InvalidSwap" });
      expect(unconditional.message).toMatch(/the PDS rejected the request/);
    });
  });
});

describe("submitCreateOnly", () => {
  const prepareProfile = () =>
    prepareRecord(DID, profile.main, {
      displayName: "Alice",
      createdAt: "2024-01-01T00:00:00.000Z",
    });

  it("reports a URI or CID that differs from the computed one", async () => {
    const record = await prepareProfile();
    const { context } = fakeRepo({ putRecord: () => json(200, { uri: record.ref.uri, cid: CID }) });

    const error = await submitCreateOnly(context, DID, record, "op").catch((e) => e);

    expect(error).toBeInstanceOf(WriteResultMismatchError);
    expect(error.reported).toEqual([{ uri: record.ref.uri, cid: CID }]);
  });
});
