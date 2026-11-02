import { afterEach, describe, expect, it, vi } from "vitest";
import { CID, DID, fakePds, json } from "../test-utils/fake-pds.js";
import { resolveRecordRef } from "./resolve-record-ref.js";

const URI = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;

describe("resolveRecordRef", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a record in the client's own repo through the client", async () => {
    const { context, requests } = fakePds(() => json(200, { uri: URI, cid: CID, value: {} }));

    const ref = await resolveRecordRef(context, URI);

    expect(ref).toEqual({ uri: URI, cid: CID });
    const url = new URL(requests[0]?.path ?? "", "https://pds.test");
    expect(url.pathname).toBe("/xrpc/com.atproto.repo.getRecord");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      repo: DID,
      collection: "org.hypercerts.claim.activity",
      rkey: "3k2a4b5c6d7e8",
    });
  });

  it("reads another account's record from the PDS in their DID document, not the client's", async () => {
    const owner = "did:plc:someoneelse456";
    const uri = `at://${owner}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === `https://plc.directory/${owner}`) {
        return json(200, {
          id: owner,
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://owner-pds.test",
            },
          ],
        });
      }
      return json(200, { uri, cid: CID, value: {} });
    });
    const { context, requests } = fakePds(() => json(500, {}));

    const ref = await resolveRecordRef(context, uri);

    expect(ref).toEqual({ uri, cid: CID });
    expect(requests).toHaveLength(0);
    const read = new URL(fetched[1] ?? "");
    expect(read.origin + read.pathname).toBe(
      "https://owner-pds.test/xrpc/com.atproto.repo.getRecord",
    );
    expect(read.searchParams.get("repo")).toBe(owner);
  });

  it("fails without asking the client's PDS when the owner's PDS cannot be resolved", async () => {
    const uri = "at://did:plc:someoneelse456/org.hypercerts.claim.activity/3k2a4b5c6d7e8";
    vi.stubGlobal("fetch", async () => json(404, {}));
    const { context, requests } = fakePds(() => json(200, {}));

    await expect(resolveRecordRef(context, uri)).rejects.toThrow(
      /cannot resolve the PDS of did:plc:someoneelse456: https:\/\/plc\.directory\/did:plc:someoneelse456 responded with HTTP 404/,
    );
    expect(requests).toHaveLength(0);
  });

  it("fails explicitly when the record does not exist", async () => {
    const { context } = fakePds(() =>
      json(400, { error: "RecordNotFound", message: "Could not locate record" }),
    );

    const error = await resolveRecordRef(context, URI).catch((e) => e);

    expect(error.message).toBe(
      `resolveRecordRef: cannot resolve ${URI}: the record was not found.`,
    );
    expect(error.cause).toMatchObject({ error: "RecordNotFound" });
  });

  it("reports other read failures with the PDS's error", async () => {
    const { context } = fakePds(() =>
      json(500, { error: "InternalServerError", message: "Database unavailable" }),
    );

    await expect(resolveRecordRef(context, URI)).rejects.toThrow(
      `resolveRecordRef: cannot resolve ${URI}: the read failed (InternalServerError: Database unavailable).`,
    );
  });

  it("fails when the PDS returns the record without a CID", async () => {
    const { context } = fakePds(() => json(200, { uri: URI, value: {} }));

    await expect(resolveRecordRef(context, URI)).rejects.toThrow(
      /returned the record without a valid CID/,
    );
  });

  // With validation off the client passes the response through as is, so these reach the SDK.
  it.each([
    ["an invalid CID", { uri: URI, cid: "not-a-cid", value: {} }, /without a valid CID/],
    [
      "a different record",
      { uri: `at://${DID}/org.hypercerts.claim.activity/other`, cid: CID, value: {} },
      /returned a different record/,
    ],
  ])("rejects a response with %s from a client that skips validation", async (_, body, message) => {
    const { context } = fakePds(() => json(200, body), { validateResponse: false });

    await expect(resolveRecordRef(context, URI)).rejects.toThrow(message);
  });

  it.each([
    ["a handle authority", "at://alice.example.com/org.hypercerts.claim.activity/3k2a4b5c6d7e8"],
    ["no record key", `at://${DID}/org.hypercerts.claim.activity`],
    ["an https URL", "https://example.com/record"],
    ["an extra path segment", `${URI}/extra`],
  ])("rejects a URI with %s before sending anything", async (_, uri) => {
    const { context, requests } = fakePds(() => json(200, {}));

    await expect(resolveRecordRef(context, uri)).rejects.toThrow(TypeError);
    await expect(resolveRecordRef(context, uri)).rejects.toThrow(/Expected at:\/\/<did>/);
    expect(requests).toHaveLength(0);
  });
});
