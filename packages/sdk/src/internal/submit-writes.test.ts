import * as profile from "@hypercerts-org/lexicon/app/certified/actor/profile";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods } from "../test-utils/fake-repo.js";
import { prepareRecord } from "./prepare-record.js";
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
