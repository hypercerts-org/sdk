import { describe, expect, it } from "vitest";
import { DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { createBadgeDefinition, WriteOutcomeUnknownError, WriteRejectedError } from "./index.js";

const DEFINITION = "app.certified.badge.definition";
const MiB = 1024 * 1024;
const ISSUER = "did:plc:issuer111";
const OTHER = "did:plc:other222";
const input = { title: "Verified steward", badgeType: "verification" };
const icon = (type: string, size = 3) => new Blob([new Uint8Array(size)], { type });

describe("createBadgeDefinition", () => {
  it("creates the definition with its issuers as DID objects and an uploaded icon, in one request", async () => {
    const { context, requests, creates } = fakeRepo();

    const ref = await createBadgeDefinition(context, {
      ...input,
      description: "Confirmed to manage the land they report on.",
      icon: icon("image/png"),
      allowedIssuers: [ISSUER, OTHER],
      createdAt: "2024-05-05T12:00:00.000Z",
    });

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    const write = writeOf(creates[0] ?? [], DEFINITION);
    expect(write.value).toMatchObject({
      $type: DEFINITION,
      title: "Verified steward",
      badgeType: "verification",
      description: "Confirmed to manage the land they report on.",
      // A raw blob field, not a wrapper object around it.
      icon: { $type: "blob", mimeType: "image/png", size: 3 },
      allowedIssuers: [
        { $type: "app.certified.defs#did", did: ISSUER },
        { $type: "app.certified.defs#did", did: OTHER },
      ],
      createdAt: "2024-05-05T12:00:00.000Z",
    });
    expect(ref).toEqual(refTo(write));
  });

  it("keeps a badge type outside the lexicon's known values", async () => {
    const { context, creates } = fakeRepo();

    await createBadgeDefinition(context, { ...input, badgeType: "stewardship-circle" });

    expect(writeOf(creates[0] ?? [], DEFINITION).value.badgeType).toBe("stewardship-circle");
  });

  it("tells an omitted issuer list (anyone) from an empty one (no one)", async () => {
    const { context, creates } = fakeRepo();

    await createBadgeDefinition(context, input);
    await createBadgeDefinition(context, { ...input, allowedIssuers: [] });

    const [anyone, nobody] = creates.map((writes) => writeOf(writes, DEFINITION).value);
    expect(anyone).not.toHaveProperty("allowedIssuers");
    expect(nobody?.allowedIssuers).toEqual([]);
  });

  it.each([
    ["image/svg+xml", 1],
    ["image/png", MiB],
  ])("uploads a %s icon of %d bytes", async (type, size) => {
    const { context, requests } = fakeRepo();

    await createBadgeDefinition(context, { ...input, icon: icon(type, size) });

    expect(methods(requests)).toContain("com.atproto.repo.uploadBlob");
  });

  it.each([
    ["a type the lexicon does not accept", icon("image/gif"), /image\/gif/],
    ["a PDF", icon("application/pdf"), /application\/pdf/],
    ["a file over 1 MiB", icon("image/png", MiB + 1), /blob too big \(maximum 1048576/],
  ])("sends nothing for an icon that is %s", async (_, file, message) => {
    const { context, requests } = fakeRepo();

    const error = await createBadgeDefinition(context, { ...input, icon: file }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/icon cannot be used as a badge icon/);
    expect(error.message).toMatch(message);
    expect(error.message).toMatch(/Nothing was uploaded/);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["an unknown field", { ...input, colour: "red" }, /has a field the SDK does not know/],
    ["a missing badge type", { title: "Verified steward" }, /badgeType/],
    ["an issuer that is not a DID", { ...input, allowedIssuers: ["alice.test"] }, /allowedIssuers/],
    ["an icon that is a URL", { ...input, icon: "https://example.org/i.png" }, /Blob or File/],
    ["a title the lexicon rejects", { ...input, title: "x".repeat(257) }, /title/],
  ])("sends nothing for %s", async (_, bad, message) => {
    const { context, requests } = fakeRepo();

    const error = await createBadgeDefinition(context, bad as never).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^createBadgeDefinition: /);
    expect(error.message).toMatch(message);
    expect(requests).toHaveLength(0);
  });

  it("does not write when the icon upload fails", async () => {
    const { context, requests } = fakeRepo({
      uploadBlob: () => json(500, { error: "InternalServerError" }),
    });

    await expect(
      createBadgeDefinition(context, { ...input, icon: icon("image/png") }),
    ).rejects.toThrow(/could not upload input.icon/);

    expect(methods(requests)).toEqual(["com.atproto.repo.uploadBlob"]);
  });

  it("reports a rejected write as definite and a write without an answer as unknown", async () => {
    const rejecting = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "no" }),
    });
    const silent = fakeRepo({ applyWrites: () => json(500, {}) });

    const rejected = await createBadgeDefinition(rejecting.context, input).catch((e) => e);
    const unknown = await createBadgeDefinition(silent.context, input).catch((e) => e);

    expect(rejected).toBeInstanceOf(WriteRejectedError);
    expect(rejected).toMatchObject({ status: 400, code: "InvalidRequest" });
    expect(unknown).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(unknown.attempted).toHaveLength(1);
    expect(unknown.attempted[0].uri).toMatch(new RegExp(`^at://${DID}/${DEFINITION}/`));
    // The SDK does not retry: one request each.
    expect(methods(silent.requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });
});
