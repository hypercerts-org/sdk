import { beforeAll, describe, expect, it } from "vitest";
import {
  createVocabularyTag,
  createWorkScopeTag,
  RecordAlreadyExistsError,
  WriteRejectedError,
} from "../src/tag/index.js";
import { unique } from "./fixtures.js";
import {
  collections,
  defined,
  expectReferencesResolve,
  expectStored,
  type Ref,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

const tag = (key: string) => ({
  category: "land-cover",
  key,
  name: unique("Tag"),
  status: "proposed",
});
const byUri = (a: Ref, b: Ref) => a.uri.localeCompare(b.uri);

describe("createVocabularyTag", () => {
  it("stores the tag at <category>.<key> with the CID the PDS reports", async () => {
    const key = unique("mangrove", "-");
    const input = { ...tag(key), description: "Tidal forest.", aliases: ["mangal"] };

    const result = await createVocabularyTag(user.context, input);

    expect(result.uri).toBe(`at://${user.did}/${collections.vocabularyTag}/land-cover.${key}`);
    expect(result.created).toBe(true);
    expect(await expectStored(user.client, result)).toMatchObject({
      ...input,
      createdAt: expect.any(String),
    });
  });

  it("refuses to overwrite: a second call throws RecordAlreadyExistsError and the first tag stays", async () => {
    const input = tag(unique("wetland", "-"));
    const first = await createVocabularyTag(user.context, input);

    const error = await createVocabularyTag(user.context, { ...input, name: "Second" }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error).toMatchObject({ uri: first.uri, status: 400, code: "InvalidSwap" });
    expect(await expectStored(user.client, first)).toMatchObject({ name: input.name });
  });

  it("lets exactly one of two simultaneous calls create the tag", async () => {
    const input = tag(unique("race", "-"));

    const results = await Promise.allSettled([
      createVocabularyTag(user.context, { ...input, name: unique("One") }),
      createVocabularyTag(user.context, { ...input, name: unique("Two") }),
    ]);

    const created = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBeInstanceOf(RecordAlreadyExistsError);
    await expectStored(user.client, defined(created[0]).value);
  });

  it("creates nested broader and superseding tags in one write and reuses an existing one", async () => {
    const existing = await createVocabularyTag(user.context, tag(unique("forest", "-")));
    const before = await snapshotCounts(user.client);

    const result = await createVocabularyTag(user.context, {
      ...tag(unique("mangrove", "-")),
      broader: [
        { uri: existing.uri },
        { ...tag(unique("wetland", "-")), broader: [tag(unique("habitat", "-"))] },
      ],
      supersededBy: tag(unique("coastal", "-")),
    });

    const stored = await expectStored(user.client, result);
    const referenced = await expectReferencesResolve(user.client, stored);
    const wetland = defined(result.broader?.[1]);
    expect(referenced.sort(byUri)).toEqual(
      [
        { uri: existing.uri, cid: existing.cid },
        { uri: wetland.uri, cid: wetland.cid },
        { uri: defined(result.supersededBy).uri, cid: defined(result.supersededBy).cid },
      ].sort(byUri),
    );
    await expectStored(user.client, defined(wetland.broader?.[0]));
    expect(result.broader?.[0]).toEqual({ ...existing, created: false });
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      vocabularyTag: before.vocabularyTag + 4,
    });
  });

  it("creates none of the tags when a nested one already exists", async () => {
    const taken = await createVocabularyTag(user.context, tag(unique("taken", "-")));
    const before = await snapshotCounts(user.client);

    const error = await createVocabularyTag(user.context, {
      ...tag(unique("child", "-")),
      broader: [
        {
          category: "land-cover",
          key: defined(taken.uri.split(".").at(-1)),
          name: "Again",
          status: "proposed",
        },
      ],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error.uri).toBe(taken.uri);
    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("createWorkScopeTag", () => {
  it("stores the tag with a TID key, a new parent and the references the PDS resolves", async () => {
    const before = await snapshotCounts(user.client);

    const result = await createWorkScopeTag(user.context, {
      key: "mangrove_restoration",
      name: unique("Mangrove restoration"),
      category: "topic",
      parent: { key: "ecosystem_restoration", name: unique("Ecosystem restoration") },
    });

    const stored = await expectStored(user.client, result);
    expect(stored).toMatchObject({ key: "mangrove_restoration", category: "topic" });
    const [parent] = await expectReferencesResolve(user.client, stored);
    expect(parent).toEqual({ uri: defined(result.parent).uri, cid: defined(result.parent).cid });
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      workScopeTag: before.workScopeTag + 2,
    });
  });
});
