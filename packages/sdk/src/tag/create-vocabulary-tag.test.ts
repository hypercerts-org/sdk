import { describe, expect, it } from "vitest";
import { CID, DID, fakePds, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo } from "../test-utils/fake-repo.js";
import {
  createVocabularyTag,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const VOCAB = "org.hypercerts.vocab.tag";
const WORKSCOPE = "org.hypercerts.workscope.tag";
const uriOf = (key: string) => `at://${DID}/${VOCAB}/${key}`;
const tag = (category: string, key: string) => ({
  category,
  key,
  name: key,
  status: "accepted",
});

describe("createVocabularyTag", () => {
  it("creates one tag at <category>.<key> with putRecord, only if absent, and reports the result", async () => {
    const { context, requests, puts } = fakeRepo();

    const result = await createVocabularyTag(context, {
      ...tag("land-cover", "mangrove"),
      description: "Tidal forest.",
      aliases: ["mangal"],
      sameAs: ["https://www.wikidata.org/wiki/Q42"],
      referenceDocument: "https://example.org/mangrove.pdf",
    });

    expect(methods(requests)).toEqual(["com.atproto.repo.putRecord"]);
    const [put] = puts;
    expect(put).toMatchObject({ collection: VOCAB, rkey: "land-cover.mangrove", swapRecord: null });
    expect(put?.value).toMatchObject({
      $type: VOCAB,
      category: "land-cover",
      key: "mangrove",
      name: "mangrove",
      status: "accepted",
      description: "Tidal forest.",
      aliases: ["mangal"],
      sameAs: ["https://www.wikidata.org/wiki/Q42"],
      referenceDocument: {
        $type: "org.hypercerts.defs#uri",
        uri: "https://example.org/mangrove.pdf",
      },
    });
    expect(result).toEqual({ ...(put && refTo(put)), created: true });
  });

  it("throws RecordAlreadyExistsError, with the URI, when the key is taken", async () => {
    const uri = uriOf("land-cover.mangrove");
    const { context, puts } = fakeRepo({ existing: { [uri]: CID } });

    const error = await createVocabularyTag(context, tag("land-cover", "mangrove")).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ uri, status: 400, code: "InvalidSwap" });
    expect(error.message).toContain(uri);
    expect(puts).toHaveLength(0);
  });

  it.each([
    ["category", { category: "land.cover", key: "mangrove" }],
    ["key", { category: "land-cover", key: "red.mangrove" }],
  ])("sends nothing for a dot in the %s", async (_, parts) => {
    const { context, requests } = fakeRepo();

    await expect(
      createVocabularyTag(context, { ...tag("land-cover", "x"), ...parts }),
    ).rejects.toThrow(/^createVocabularyTag: invalid input: .*must not contain dots/);

    expect(requests).toHaveLength(0);
  });

  it("sends nothing for a tag the lexicon rejects", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createVocabularyTag(context, { ...tag("land-cover", "mangrove"), name: "x".repeat(201) }),
    ).rejects.toThrow(/^createVocabularyTag: input is not a valid org\.hypercerts\.vocab\.tag/);

    expect(requests).toHaveLength(0);
  });

  it("creates new nested tags with an existing one in one write, children first, keeping the order", async () => {
    const existingUri = uriOf("land-cover.forest");
    const { context, requests, creates } = fakeRepo({ existing: { [existingUri]: CID } });

    const result = await createVocabularyTag(context, {
      ...tag("land-cover", "mangrove"),
      broader: [
        { uri: existingUri },
        { ...tag("land-cover", "wetland"), broader: [tag("land-cover", "habitat")] },
      ],
      supersededBy: tag("land-cover", "coastal-forest"),
    });

    // The existing tag and the four new keys are read before anything is written.
    expect(methods(requests)).toEqual([
      ...Array(5).fill("com.atproto.repo.getRecord"),
      "com.atproto.repo.applyWrites",
    ]);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.rkey)).toEqual([
      "land-cover.habitat",
      "land-cover.wetland",
      "land-cover.coastal-forest",
      "land-cover.mangrove",
    ]);
    const [habitat, wetland, coastal, mangrove] = writes.map(refTo);
    expect(writes[1]?.value.broader).toEqual([habitat]);
    expect(writes[3]?.value).toMatchObject({
      broader: [{ uri: existingUri, cid: CID }, wetland],
      supersededBy: coastal,
    });
    // The result mirrors the input, to any depth.
    expect(result).toEqual({
      ...mangrove,
      created: true,
      broader: [
        { uri: existingUri, cid: CID, created: false },
        { ...wetland, created: true, broader: [{ ...habitat, created: true }] },
      ],
      supersededBy: { ...coastal, created: true },
    });
  });

  it("reads a nested tag's taken key before uploading or writing anything", async () => {
    const taken = uriOf("land-cover.habitat");
    const { context, requests } = fakeRepo({ existing: { [taken]: CID } });

    const error = await createVocabularyTag(context, {
      ...tag("land-cover", "wetland"),
      referenceDocument: new Blob(["doc"], { type: "application/pdf" }),
      broader: [tag("land-cover", "habitat")],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toMatchObject({ uri: taken, attempted: [] });
    expect(error.message).toContain("input.broader[0]");
    expect(methods(requests).every((method) => method === "com.atproto.repo.getRecord")).toBe(true);
  });

  it("does not write when the key of a new tag cannot be checked", async () => {
    // A server error on getRecord is not the answer "absent".
    const { context, requests } = fakePds(() => json(500, { error: "InternalServerError" }));

    await expect(
      createVocabularyTag(context, {
        ...tag("land-cover", "wetland"),
        broader: [tag("land-cover", "habitat")],
      }),
    ).rejects.toThrow(/cannot check whether at:\/\/.* already exists.*nothing was written/);

    expect(methods(requests).every((method) => method === "com.atproto.repo.getRecord")).toBe(true);
  });

  it.each([
    [
      "the root and a nested tag",
      { ...tag("land-cover", "mangrove"), broader: [tag("land-cover", "mangrove")] },
      /input\.broader\[0\] and input are both new org\.hypercerts\.vocab\.tag records with the key land-cover\.mangrove/,
    ],
    [
      "two nested tags",
      {
        ...tag("land-cover", "mangrove"),
        broader: [
          tag("land-cover", "forest"),
          { ...tag("land-cover", "wetland"), supersededBy: tag("land-cover", "forest") },
        ],
      },
      /input\.broader\[0\] and input\.broader\[1\]\.supersededBy are both new/,
    ],
  ])("sends nothing when %s have the same key", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    await expect(createVocabularyTag(context, input)).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("sends nothing for the URI of a work-scope tag where a vocabulary tag is needed", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createVocabularyTag(context, {
        ...tag("land-cover", "mangrove"),
        broader: [{ uri: `at://${DID}/${WORKSCOPE}/3k2a4b5c6d7e8` }],
      }),
    ).rejects.toThrow(
      /input\.broader\[0\] points at a record of type org\.hypercerts\.workscope\.tag, but this field holds org\.hypercerts\.vocab\.tag/,
    );

    expect(requests).toHaveLength(0);
  });

  it("says calling again is safe after an unknown outcome, because every tag has a fixed key", async () => {
    const { context } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createVocabularyTag(context, {
      ...tag("land-cover", "wetland"),
      broader: [tag("land-cover", "habitat")],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(error.message).toMatch(/calling createVocabularyTag again is safe.*already exists/);
    expect(error.attempted).toHaveLength(2);
  });
});
