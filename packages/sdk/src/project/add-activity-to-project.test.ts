import type { LexMap } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, DID } from "../test-utils/fake-pds.js";
import { fakeRepo, HEAD, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { addActivityToProject } from "./index.js";

const ACTIVITY = "org.hypercerts.claim.activity";
const COLLECTION = "org.hypercerts.collection";

const projectUri = `at://${DID}/${COLLECTION}/3k2a4b5c6d7e8`;
const activity = { title: "Trees", shortDescription: "Planting trees" };
const untyped = {
  $type: COLLECTION,
  title: "Phobjikha valley",
  createdAt: "2024-01-01T00:00:00.000Z",
  items: [{ itemIdentifier: { uri: `at://${DID}/${ACTIVITY}/3jzfcijpj2z2a`, cid: CID } }],
};
const project = { ...untyped, type: "project" };

describe("addActivityToProject", () => {
  it("appends a new Activity to a Project, guarded by the head commit, and reports the Project as `uri` and `cid`", async () => {
    const { context, creates, updates, swapCommits } = fakeRepo({
      records: { [projectUri]: project },
    });

    const result = await addActivityToProject(context, {
      project: { uri: projectUri },
      activity,
      weight: "2",
    });

    const created = writeOf(creates[0] ?? [], ACTIVITY);
    const update = writeOf(updates[0] ?? [], COLLECTION);
    expect(update.value).toEqual({
      ...project,
      items: [...project.items, { itemIdentifier: refTo(created), itemWeight: "2" }],
    });
    expect(swapCommits).toEqual([HEAD]);
    expect(result).toEqual({
      uri: projectUri,
      cid: update.cid,
      activity: { ...refTo(created), created: true, locations: [], contributors: [] },
    });
  });

  it("adds an existing Activity with one putRecord guarded by the Project's CID, and no head", async () => {
    const existing = `at://${DID}/${ACTIVITY}/3k2a4b5c6d7e9`;
    const { context, requests, puts, updates, swapCommits } = fakeRepo({
      existing: { [existing]: CID },
      records: { [projectUri]: project },
    });

    const result = await addActivityToProject(context, {
      project: { uri: projectUri },
      activity: { uri: existing },
    });

    expect(methods(requests).filter((m) => !m.endsWith("getRecord"))).toEqual([
      "com.atproto.repo.putRecord",
    ]);
    expect([updates, swapCommits]).toEqual([[], []]);
    expect(puts[0]?.swapRecord).toEqual(expect.any(String));
    expect(puts[0]?.value.items).toEqual([
      ...project.items,
      { itemIdentifier: { uri: existing, cid: CID } },
    ]);
    expect(result.uri).toBe(projectUri);
  });

  it.each([
    [
      "a Collection of another type",
      { ...project, type: "portfolio" },
      /that has type "portfolio"/,
    ],
    ["a Collection with no type", untyped, /that has no type/],
  ])(
    "refuses %s, naming addActivityToCollection, before any upload",
    async (_, record, message) => {
      const { context, requests } = fakeRepo({ records: { [projectUri]: record } });
      const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

      const error = await addActivityToProject(context, {
        project: { uri: projectUri },
        activity: { ...activity, image },
      }).catch((e) => e);

      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(message);
      expect(error.message).toMatch(
        /use addActivityToCollection from @hypercerts-org\/sdk\/collection/,
      );
      expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
    },
  );

  it("refuses a Collection that stopped being a Project after the first read, writing nothing", async () => {
    // The second read, after the head, is the one the write is guarded by, so it is checked too.
    const records: Record<string, LexMap> = { [projectUri]: project };
    let reads = 0;
    const { context, requests } = fakeRepo({
      records,
      onRequest: (method) => {
        if (method === "com.atproto.repo.getRecord" && ++reads === 2) {
          records[projectUri] = { ...project, type: "portfolio" };
        }
      },
    });

    await expect(
      addActivityToProject(context, { project: { uri: projectUri }, activity }),
    ).rejects.toThrow(/that has type "portfolio"/);

    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
  });

  it.each([
    [
      "a weight over 100 characters",
      { project: { uri: projectUri }, activity, weight: "1".repeat(101) },
      /invalid input: must be at most 100 characters at \$\.weight/,
    ],
    [
      "`collection` in place of `project`",
      { collection: { uri: projectUri }, activity },
      /Allowed fields: project, activity, weight/,
    ],
    ["a bare URI string as `project`", { project: projectUri, activity }, /invalid input\.project/],
    [
      "a Project of another account",
      {
        project: { uri: "at://did:plc:someoneelse/org.hypercerts.collection/3k2a4b5c6d7e8" },
        activity,
      },
      /project\.uri is in the repository of did:plc:someoneelse.*own Projects/,
    ],
  ])("sends nothing for %s", async (_, input, message) => {
    const { context, requests } = fakeRepo({ records: { [projectUri]: project } });

    await expect(addActivityToProject(context, input as never)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });
});
