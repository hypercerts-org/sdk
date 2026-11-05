import { describe, expect, it } from "vitest";
import type { SDKContext } from "../context.js";
import { DID } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  createContribution,
  createContributorInformation,
  createRights,
  type StrongRef,
} from "./index.js";

type Creator = (context: SDKContext, input: never) => Promise<StrongRef>;

describe.each<[string, Creator, string, object]>([
  [
    "createRights",
    createRights as Creator,
    "org.hypercerts.claim.rights",
    { rightsName: "CC BY", rightsType: "CC-BY", rightsDescription: "Share with credit" },
  ],
  [
    "createContributorInformation",
    createContributorInformation as Creator,
    "org.hypercerts.claim.contributorInformation",
    { identifier: "did:plc:alice123", displayName: "Alice" },
  ],
  [
    "createContribution",
    createContribution as Creator,
    "org.hypercerts.claim.contribution",
    { role: "Lead", startDate: "2024-01-01T00:00:00Z" },
  ],
])("%s", (_, create, collection, input) => {
  it("creates one record in the client's repo and returns its URI and CID", async () => {
    const { context, requests, creates } = fakeRepo();

    const ref = await create(context, input as never);

    expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
    expect(creates[0]).toHaveLength(1);
    const write = writeOf(creates[0] ?? [], collection);
    expect(write.value).toMatchObject({ $type: collection, ...input });
    expect(typeof write.value.createdAt).toBe("string");
    expect(ref).toEqual(refTo(write));
    expect(ref.uri.startsWith(`at://${DID}/${collection}/`)).toBe(true);
  });
});

describe("standalone creators and blobs", () => {
  it("uploads a rights attachment before writing the record", async () => {
    const { context, requests, creates } = fakeRepo();
    const attachment = new Blob(["terms"], { type: "application/pdf" });

    await createRights(context, {
      rightsName: "Custom",
      rightsType: "CUSTOM",
      rightsDescription: "See the attached terms",
      attachment,
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    expect(writeOf(creates[0] ?? [], "org.hypercerts.claim.rights").value.attachment).toMatchObject(
      {
        $type: "org.hypercerts.defs#smallBlob",
        blob: { $type: "blob", mimeType: "application/pdf", size: 5 },
      },
    );
  });

  it("sends nothing for input with an unknown field", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createRights(context, {
        rightsName: "x",
        rightsType: "x",
        rightsDescription: "x",
        typo: 1,
      } as never),
    ).rejects.toThrow(/^createRights: invalid input: has a field the SDK does not know/);

    expect(requests).toHaveLength(0);
  });

  it("rejects an end date before the start date", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createContribution(context, {
        startDate: "2024-02-01T00:00:00Z",
        endDate: "2024-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/endDate before its startDate/);

    expect(requests).toHaveLength(0);
  });
});
