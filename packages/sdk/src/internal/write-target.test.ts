import * as rights from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import { describe, expect, it } from "vitest";
import { DID } from "../test-utils/fake-pds.js";
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
});
