import { describe, expect, it } from "vitest";
import { CID, DID } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo } from "../test-utils/fake-repo.js";
import { createWorkScopeTag, type WorkScopeTagInput } from "./index.js";

const WORKSCOPE = "org.hypercerts.workscope.tag";
const VOCAB = "org.hypercerts.vocab.tag";
const uriOf = (collection: string) => `at://${DID}/${collection}/3k2a4b5c6d7e8`;
const tag = (key: string) => ({ key, name: key });

describe("createWorkScopeTag", () => {
  it("creates one tag with a TID key, storing a reference document as a URL or an upload", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createWorkScopeTag(context, {
      ...tag("mangrove_restoration"),
      category: "topic",
      status: "accepted",
      referenceDocument: new Blob(["policy"], { type: "application/pdf" }),
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    const [write] = creates[0] ?? [];
    expect(write?.collection).toBe(WORKSCOPE);
    expect(write?.rkey).toMatch(/^[234567a-z]{13}$/);
    expect(write?.value).toMatchObject({
      key: "mangrove_restoration",
      name: "mangrove_restoration",
      category: "topic",
      status: "accepted",
      referenceDocument: {
        $type: "org.hypercerts.defs#smallBlob",
        blob: { mimeType: "application/pdf", size: 6 },
      },
    });
    expect(result).toEqual({ ...(write && refTo(write)), created: true });
  });

  it("creates a new parent and an existing replacement in one write, parent first", async () => {
    const replacement = uriOf(WORKSCOPE);
    const { context, requests, creates } = fakeRepo({ existing: { [replacement]: CID } });

    const result = await createWorkScopeTag(context, {
      ...tag("mangrove_restoration"),
      status: "deprecated",
      parent: { ...tag("ecosystem_restoration"), parent: tag("restoration") },
      supersededBy: { uri: replacement },
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord",
      "com.atproto.repo.applyWrites",
    ]);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.value.key)).toEqual([
      "restoration",
      "ecosystem_restoration",
      "mangrove_restoration",
    ]);
    const [restoration, ecosystem, mangrove] = writes.map(refTo);
    expect(writes[1]?.value.parent).toEqual(restoration);
    expect(writes[2]?.value).toMatchObject({
      parent: ecosystem,
      supersededBy: { uri: replacement, cid: CID },
    });
    expect(result).toEqual({
      ...mangrove,
      created: true,
      parent: { ...ecosystem, created: true, parent: { ...restoration, created: true } },
      supersededBy: { uri: replacement, cid: CID, created: false },
    });
  });

  it("sends nothing for the URI of a vocabulary tag where a work-scope tag is needed", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createWorkScopeTag(context, { ...tag("x"), parent: { uri: uriOf(VOCAB) } }),
    ).rejects.toThrow(
      /input\.parent points at a record of type org\.hypercerts\.vocab\.tag, but this field holds org\.hypercerts\.workscope\.tag/,
    );

    expect(requests).toHaveLength(0);
  });

  it("sends nothing when the call would create more records than one write holds", async () => {
    const { context, requests } = fakeRepo();
    let chain: WorkScopeTagInput = tag("tag_0");
    for (let i = 1; i <= 200; i++) chain = { ...tag(`tag_${i}`), parent: chain };

    await expect(createWorkScopeTag(context, chain)).rejects.toThrow(
      /would create 201 records, but one write holds at most 200\. Nothing was written/,
    );

    expect(requests).toHaveLength(0);
  });
});
