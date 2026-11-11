import { type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { type AwardBadgeInput, awardBadge, WriteOutcomeUnknownError } from "./index.js";

const DEFINITION = "app.certified.badge.definition";
const AWARD = "app.certified.badge.award";
const ACTIVITY = "org.hypercerts.claim.activity";
const OTHER = "did:plc:other222";

const definitionUri = `at://${DID}/${DEFINITION}/3k2a4b5c6d7e8`;
const subjectRecordUri = `at://${DID}/${ACTIVITY}/3k2a4b5c6d7e8`;
const newDefinition = { title: "Field verified", badgeType: "verification" };
const stored = (extra: LexMap = {}): LexMap => ({
  $type: DEFINITION,
  title: "Verified steward",
  badgeType: "verification",
  createdAt: "2024-01-01T00:00:00.000Z",
  ...extra,
});
// The CID the fake PDS reports for a stored record, as a PDS computes it from the stored value.
const cidOf = async (value: LexMap) =>
  (await cidForLex(lexParse(JSON.stringify(value)))).toString();
const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

const award = (input: Partial<AwardBadgeInput> = {}): AwardBadgeInput => ({
  definition: { uri: definitionUri },
  subject: { did: OTHER },
  ...input,
});

describe("awardBadge", () => {
  it("creates a new definition and the award in one request, the award pinning the definition's CID", async () => {
    const { context, requests, creates, updates } = fakeRepo();

    const result = await awardBadge(
      context,
      award({ definition: { ...newDefinition, icon: png() }, note: "Visited the site." }),
    );

    expect(methods(requests)).toEqual([
      "com.atproto.repo.uploadBlob",
      "com.atproto.repo.applyWrites",
    ]);
    // One commit, the definition first.
    expect(creates).toHaveLength(1);
    expect((creates[0] ?? []).map((write) => write.collection)).toEqual([DEFINITION, AWARD]);
    expect(updates[0]).toEqual([]);
    const created = writeOf(creates[0] ?? [], DEFINITION);
    const awarded = writeOf(creates[0] ?? [], AWARD);
    expect(created.value).toMatchObject({ ...newDefinition, icon: { mimeType: "image/png" } });
    expect(awarded.value).toMatchObject({
      badge: refTo(created),
      subject: { $type: "app.certified.defs#did", did: OTHER },
      note: "Visited the site.",
    });
    expect(awarded.value).not.toHaveProperty("validFrom");
    expect(awarded.value).not.toHaveProperty("validUntil");
    expect(result).toEqual({
      award: refTo(awarded),
      definition: { ...refTo(created), created: true },
    });
  });

  it("reuses an existing definition as it is, pinning the version that was read", async () => {
    const definition = stored({ allowedIssuers: [{ did: DID }] });
    const { context, requests, creates, updates } = fakeRepo({
      records: { [definitionUri]: definition },
    });

    const result = await awardBadge(context, award());

    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord",
      "com.atproto.repo.applyWrites",
    ]);
    // Only the award is written; the definition is neither created nor rewritten.
    expect((creates[0] ?? []).map((write) => write.collection)).toEqual([AWARD]);
    expect(updates[0]).toEqual([]);
    const cid = await cidOf(definition);
    expect(writeOf(creates[0] ?? [], AWARD).value.badge).toEqual({ uri: definitionUri, cid });
    expect(result.definition).toEqual({ uri: definitionUri, cid, created: false });
  });

  it("awards a record of any type with a strong reference to the version that was read", async () => {
    const { context, creates } = fakeRepo({
      existing: { [subjectRecordUri]: CID },
      records: { [definitionUri]: stored() },
    });

    await awardBadge(context, award({ subject: { uri: subjectRecordUri } }));

    expect(writeOf(creates[0] ?? [], AWARD).value.subject).toEqual({
      $type: "com.atproto.repo.strongRef",
      uri: subjectRecordUri,
      cid: CID,
    });
  });

  it("keeps the validity timestamps as written", async () => {
    const { context, creates } = fakeRepo({ records: { [definitionUri]: stored() } });

    await awardBadge(
      context,
      award({
        validFrom: "2019-06-01T00:00:00.000Z",
        validUntil: "2030-01-01T00:00:00.000Z",
        createdAt: "2024-05-05T12:00:00.000Z",
        url: "https://example.org/certificate",
      }),
    );

    expect(writeOf(creates[0] ?? [], AWARD).value).toMatchObject({
      validFrom: "2019-06-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
      createdAt: "2024-05-05T12:00:00.000Z",
      url: "https://example.org/certificate",
    });
  });
});

describe("awardBadge validity", () => {
  it.each([
    [
      "ends at the start",
      { validFrom: "2024-01-01T00:00:00.000Z", validUntil: "2024-01-01T00:00:00.000Z" },
    ],
    [
      "ends before createdAt but after an earlier validFrom",
      {
        validFrom: "2019-01-01T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
        validUntil: "2020-01-01T00:00:00.000Z",
      },
    ],
  ])("accepts an award that %s", async (_, validity) => {
    const { context, creates } = fakeRepo({ records: { [definitionUri]: stored() } });

    await awardBadge(context, award(validity));

    expect(creates).toHaveLength(1);
  });

  it.each([
    [
      "validUntil before validFrom",
      { validFrom: "2025-01-01T00:00:00.000Z", validUntil: "2024-01-01T00:00:00.000Z" },
      /validUntil \(2024-01-01T00:00:00.000Z\) is earlier than validFrom \(2025-01-01T00:00:00.000Z\)/,
    ],
    [
      "validUntil before createdAt, without validFrom",
      { createdAt: "2024-05-01T00:00:00.000Z", validUntil: "2024-04-01T00:00:00.000Z" },
      /earlier than createdAt \(2024-05-01T00:00:00.000Z\), which is when the badge starts/,
    ],
    [
      "validUntil between createdAt and a later validFrom",
      {
        createdAt: "2024-01-01T00:00:00.000Z",
        validFrom: "2030-01-01T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
      },
      /earlier than validFrom/,
    ],
    [
      "validUntil in the past, with createdAt defaulting to now",
      { validUntil: "2000-01-01T00:00:00.000Z" },
      /createdAt defaults to the time of the call/,
    ],
  ])("sends nothing for %s", async (_, validity, message) => {
    const { context, requests } = fakeRepo({ records: { [definitionUri]: stored() } });

    const error = await awardBadge(context, award(validity)).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(message);
    expect(requests).toHaveLength(0);
  });
});

describe("awardBadge issuers", () => {
  const listing = (allowedIssuers?: string[]) =>
    stored(
      allowedIssuers === undefined
        ? {}
        : { allowedIssuers: allowedIssuers.map((did) => ({ did })) },
    );

  it.each([
    ["no list", undefined],
    ["a list with the signed-in account", [DID]],
    ["a list with the signed-in account among others", [OTHER, DID]],
  ])("lets the signed-in account award an existing definition with %s", async (_, issuers) => {
    const { context, creates } = fakeRepo({ records: { [definitionUri]: listing(issuers) } });

    await awardBadge(context, award());

    expect(creates).toHaveLength(1);
  });

  it.each([
    ["a list without the signed-in account", [OTHER], /lets only did:plc:other222 award it/],
    ["an empty list", [], /lists no allowed issuers, so no one can award it/],
  ])("refuses an existing definition with %s, writing nothing", async (_, issuers, message) => {
    const { context, requests } = fakeRepo({ records: { [definitionUri]: listing(issuers) } });

    const error = await awardBadge(context, award()).catch((e) => e);

    expect(error.message).toMatch(message);
    expect(error.message).toMatch(/signed in as did:plc:testowner123.*No record was written/);
    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
  });

  it.each([
    [
      "a list without the signed-in account",
      { allowedIssuers: [OTHER] },
      /lets only did:plc:other222/,
    ],
    ["an empty list", { allowedIssuers: [] }, /lists no allowed issuers/],
  ])(
    "refuses a new definition with %s before reading or uploading anything",
    async (_, extra, message) => {
      const { context, requests } = fakeRepo();

      const error = await awardBadge(
        context,
        award({ definition: { ...newDefinition, ...extra, icon: png() } }),
      ).catch((e) => e);

      expect(error.message).toMatch(/the new badge definition/);
      expect(error.message).toMatch(message);
      expect(requests).toHaveLength(0);
    },
  );

  it("lets the signed-in account award a new definition that lists them", async () => {
    const { context, creates } = fakeRepo();

    await awardBadge(context, award({ definition: { ...newDefinition, allowedIssuers: [DID] } }));

    expect(writeOf(creates[0] ?? [], DEFINITION).value.allowedIssuers).toEqual([
      { $type: "app.certified.defs#did", did: DID },
    ]);
  });
});

describe("awardBadge input and references", () => {
  it.each<[string, Partial<AwardBadgeInput> | Record<string, unknown>, RegExp]>([
    [
      "a subject that is neither",
      { subject: { name: "Alice" } },
      /subject must be \{ did \} for an account or \{ uri \} for a record/,
    ],
    [
      "a subject with both",
      { subject: { did: OTHER, uri: subjectRecordUri } },
      /subject.*has a field the SDK does not know/,
    ],
    ["a subject DID that is not one", { subject: { did: "alice.test" } }, /invalid subject: .*did/],
    [
      "a subject that is a handle URI",
      { subject: { uri: `at://alice.test/${ACTIVITY}/3k2a4b5c6d7e8` } },
      /not a record URI/,
    ],
    [
      "a subject URI without a record key",
      { subject: { uri: `at://${DID}/${ACTIVITY}` } },
      /not a record URI/,
    ],
    [
      "a definition that mixes { uri } with fields",
      { definition: { uri: definitionUri, title: "Other" } as never },
      /definition combines `uri` with other fields/,
    ],
    [
      "a definition URI of another type of record",
      { definition: { uri: subjectRecordUri } },
      /definition points at a record of type org.hypercerts.claim.activity, but this field holds app.certified.badge.definition/,
    ],
    [
      "a definition URI with a handle",
      { definition: { uri: `at://alice.test/${DEFINITION}/3k2a4b5c6d7e8` } },
      /definition must use a DID as the authority, not a handle/,
    ],
    [
      "a new definition without a title",
      { definition: { badgeType: "verification" } as never },
      /invalid definition: .*title/,
    ],
    ["an unknown field", { colour: "red" }, /has a field the SDK does not know/],
    [
      "a note over 500 characters",
      { note: "x".repeat(501) },
      /the award is not a valid app.certified.badge.award/,
    ],
  ])("sends nothing for %s", async (_, bad, message) => {
    const { context, requests } = fakeRepo({ records: { [definitionUri]: stored() } });

    const error = await awardBadge(context, { ...award(), ...bad } as AwardBadgeInput).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(message);
    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
    expect(methods(requests)).not.toContain("com.atproto.repo.uploadBlob");
  });

  it.each<[string, Parameters<typeof fakeRepo>[0], Partial<AwardBadgeInput>, RegExp]>([
    [
      "an existing definition that does not exist",
      {},
      {},
      /cannot resolve .*the record was not found/,
    ],
    [
      "an existing definition that is not valid",
      { records: { [definitionUri]: { $type: DEFINITION, title: "No type" } } },
      {},
      /is not a valid app.certified.badge.definition record.*cannot be awarded/,
    ],
    [
      "a subject record that does not exist",
      { records: { [definitionUri]: stored() } },
      { subject: { uri: subjectRecordUri } },
      /cannot resolve .*the record was not found/,
    ],
  ])("does not write for %s", async (_, options, input, message) => {
    const { context, requests } = fakeRepo(options);

    await expect(awardBadge(context, award(input))).rejects.toThrow(message);

    expect(methods(requests)).not.toContain("com.atproto.repo.applyWrites");
  });

  it("does not upload a new definition's icon when the subject cannot be read", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      awardBadge(
        context,
        award({
          definition: { ...newDefinition, icon: png() },
          subject: { uri: subjectRecordUri },
        }),
      ),
    ).rejects.toThrow(/cannot resolve/);

    expect(methods(requests)).not.toContain("com.atproto.repo.uploadBlob");
  });

  it("does not write when the new definition's icon is refused or its upload fails", async () => {
    const refused = fakeRepo();
    const failing = fakeRepo({ uploadBlob: () => json(500, { error: "InternalServerError" }) });

    await expect(
      awardBadge(
        refused.context,
        award({ definition: { ...newDefinition, icon: new Blob(["x"], { type: "image/gif" }) } }),
      ),
    ).rejects.toThrow(/definition\.icon cannot be used as a badge icon/);
    await expect(
      awardBadge(failing.context, award({ definition: { ...newDefinition, icon: png() } })),
    ).rejects.toThrow(/could not upload definition\.icon/);

    expect(methods(refused.requests)).not.toContain("com.atproto.repo.uploadBlob");
    expect(methods(failing.requests)).not.toContain("com.atproto.repo.applyWrites");
  });
});

describe("awardBadge when the write fails", () => {
  it("lists the new definition and the award when the outcome is unknown, and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await awardBadge(context, award({ definition: newDefinition })).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    const [definition, awarded] = error.attempted.map((ref: { uri: string }) => ref.uri);
    expect(definition).toMatch(new RegExp(`/${DEFINITION}/`));
    expect(awarded).toMatch(new RegExp(`/${AWARD}/`));
    for (const uri of [definition, awarded]) expect(error.message).toContain(uri);
    expect(methods(requests).filter((method) => method.endsWith("applyWrites"))).toHaveLength(1);
  });

  it("creates a second award when called again with the same input", async () => {
    const { context, creates } = fakeRepo({ records: { [definitionUri]: stored() } });

    const first = await awardBadge(context, award());
    const second = await awardBadge(context, award());

    expect(first.award.uri).not.toBe(second.award.uri);
    expect(creates).toHaveLength(2);
  });
});
