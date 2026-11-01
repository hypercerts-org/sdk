import { describe, expect, it } from "vitest";
import { CID, DID, fakePds, json } from "../test-utils/fake-pds.js";
import { resolveRecordRef } from "./resolve-record-ref.js";

const URI = `at://${DID}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;

describe("resolveRecordRef", () => {
  it("reads the record from the repo named in the URI and returns its URI and CID", async () => {
    const otherRepo = "did:plc:someoneelse456";
    const uri = `at://${otherRepo}/org.hypercerts.claim.activity/3k2a4b5c6d7e8`;
    const { context, requests } = fakePds(() => json(200, { uri, cid: CID, value: {} }));

    const ref = await resolveRecordRef(context, uri);

    expect(ref).toEqual({ uri, cid: CID });
    const url = new URL(requests[0]?.path ?? "", "https://pds.test");
    expect(url.pathname).toBe("/xrpc/com.atproto.repo.getRecord");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      repo: otherRepo,
      collection: "org.hypercerts.claim.activity",
      rkey: "3k2a4b5c6d7e8",
    });
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

  it("says a missing record in another repo may only be invisible from the client's PDS", async () => {
    const uri = "at://did:plc:someoneelse456/org.hypercerts.claim.activity/3k2a4b5c6d7e8";
    const { context } = fakePds(() =>
      json(400, { error: "RecordNotFound", message: "Could not locate record" }),
    );

    await expect(resolveRecordRef(context, uri)).rejects.toThrow(
      /not found\. Reads go through your client's PDS/,
    );
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
