import type { RecordKeyString } from "@atproto/lex";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { describe, expect, it } from "vitest";
import { DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo } from "../test-utils/fake-repo.js";
import { prepareRecord } from "./prepare-record.js";
import { pdsTarget } from "./write-target.js";

describe("pdsTarget", () => {
  it("rejects a create-only plan that is not exactly one create", async () => {
    const { context } = fakeRepo({});
    const record = await prepareRecord(DID, rights.main, {
      rightsName: "CC BY",
      rightsType: "CC-BY",
      rightsDescription: "Share with credit",
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    const error = await pdsTarget(context, DID, "op")
      .submit({ creates: [record, record], updates: [], createOnly: true })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("exactly one create");
  });

  it("reports a missing record as undefined", async () => {
    const { context } = fakeRepo({});
    const target = pdsTarget(context, DID, "op");

    await expect(
      target.recordExists(rights.$nsid, "3k2a4b5c6d7e8" as RecordKeyString),
    ).resolves.toBeUndefined();
  });

  it("names the operation and cause when the head cannot be read", async () => {
    const { context } = fakeRepo({
      getLatestCommit: () => json(500, { error: "InternalServerError", message: "down" }),
    });

    const error = await pdsTarget(context, DID, "op")
      .readHead()
      .catch((e) => e);

    expect(error.message).toMatch(/^op: cannot read the latest commit of did:plc:testowner123/);
    expect(error.message).toContain("Nothing was written.");
    expect(error.cause).toBeDefined();
  });
});
