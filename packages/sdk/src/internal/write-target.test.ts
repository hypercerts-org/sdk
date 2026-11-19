import type { RecordKeyString } from "@atproto/lex";
import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { describe, expect, it } from "vitest";
import { DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo } from "../test-utils/fake-repo.js";
import { prepareRecord } from "./prepare-record.js";
import { pdsTarget } from "./write-target.js";

describe("pdsTarget", () => {
  it.each([
    { name: "is not exactly one create", twoCreates: true, match: "exactly one create" },
    { name: "carries swapCommit", twoCreates: false, swapCommit: "bafyhead", match: "swapCommit" },
  ])("rejects a create-only plan that $name", async ({ twoCreates, swapCommit, match }) => {
    const { context } = fakeRepo({});
    const record = await prepareRecord(DID, rights.main, {
      rightsName: "CC BY",
      rightsType: "CC-BY",
      rightsDescription: "Share with credit",
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    const error = await pdsTarget(context, DID, "op")
      .submit({
        creates: twoCreates ? [record, record] : [record],
        updates: [],
        createOnly: true,
        swapCommit,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(match);
  });

  it("returns the uri and cid of an existing record", async () => {
    const rkey = "3k2a4b5c6d7e8" as RecordKeyString;
    const uri = `at://${DID}/${rights.$nsid}/${rkey}`;
    const cid = "bafkreie7fzwthi3rp3ucmnj2ibf2iymndlxlnb4226jwxtuo2x2gqfesju";
    const { context } = fakeRepo({ existing: { [uri]: cid } });

    await expect(pdsTarget(context, DID, "op").recordExists(rights.$nsid, rkey)).resolves.toEqual({
      uri,
      cid,
    });
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
