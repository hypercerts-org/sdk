import * as defs from "@hypercerts-org/lexicon/app/certified/defs";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/activity/index.js";
import { awardBadge, createBadgeDefinition, respondToBadgeAward } from "../src/badge/index.js";
import { readE2eEnv } from "./env.js";
import { PNG, png, unique } from "./fixtures.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  blobIn,
  collections,
  deleteStored,
  expectBlobServed,
  expectReferencesResolve,
  expectStored,
  type Ref,
  snapshotCounts,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

// `user` defines and awards badges. `other` is the recipient: only it can respond to an award, and
// its Activity is a record `user` can award a badge to.
let user: Account;
let other: Account;
let otherActivity: Ref;

beforeAll(async () => {
  redirectPlcDirectory(readE2eEnv().plcUrl);
  [user, other] = await Promise.all([loginAs("user1"), loginAs("user2")]);
  expect(other.did, "SDK_E2E_USER2 must be a different account than SDK_E2E_USER1").not.toBe(
    user.did,
  );
  const activity = await createActivity(other.context, {
    title: unique("E2E badge subject"),
    shortDescription: "Planting native trees",
  });
  otherActivity = { uri: activity.uri, cid: activity.cid };
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteStored(other.client, otherActivity.uri);
});

const newDefinition = (extra: Record<string, unknown> = {}) => ({
  title: unique("Verified steward"),
  badgeType: "verification",
  ...extra,
});

describe("createBadgeDefinition", () => {
  it("stores the definition with its issuers as DID objects and the icon the PDS serves", async () => {
    const input = newDefinition({
      description: "Checked on site.",
      icon: png(),
      allowedIssuers: [user.did, other.did],
    });

    const result = await createBadgeDefinition(user.context, input);

    expect(result.uri.startsWith(`at://${user.did}/${collections.badgeDefinition}/`)).toBe(true);
    const stored = await expectStored(user.client, result);
    expect(stored).toMatchObject({
      title: input.title,
      badgeType: "verification",
      description: "Checked on site.",
      allowedIssuers: [
        { $type: defs.did.$type, did: user.did },
        { $type: defs.did.$type, did: other.did },
      ],
    });
    await expectBlobServed(user.client, user.did, blobIn(stored, "icon"), PNG);
  });

  it("writes nothing when the icon is not an allowed image type", async () => {
    const before = await snapshotCounts(user.client);

    const error = await createBadgeDefinition(
      user.context,
      newDefinition({ icon: new Blob(["GIF89a"], { type: "image/gif" }) }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/cannot be used as a badge icon/);
    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("awardBadge", () => {
  it("creates a new definition and an award to an account in one commit, the award pinning the definition's CID", async () => {
    const before = await snapshotCounts(user.client);

    const result = await awardBadge(user.context, {
      definition: newDefinition(),
      subject: { did: other.did },
      note: "Completed the stewardship course.",
    });

    expect(result.definition.created).toBe(true);
    const award = await expectStored(user.client, result.award);
    expect(award).toMatchObject({
      subject: { $type: defs.did.$type, did: other.did },
      note: "Completed the stewardship course.",
    });
    expect(await expectReferencesResolve(user.client, award)).toEqual([
      { uri: result.definition.uri, cid: result.definition.cid },
    ]);
    await expectStored(user.client, result.definition);
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      badgeDefinition: before.badgeDefinition + 1,
      badgeAward: before.badgeAward + 1,
    });
  });

  it("reuses an existing definition and awards another account's record with a strong reference", async () => {
    const definition = await createBadgeDefinition(user.context, newDefinition());
    const before = await snapshotCounts(user.client);

    const result = await awardBadge(user.context, {
      definition: { uri: definition.uri },
      subject: { uri: otherActivity.uri },
    });

    expect(result.definition).toEqual({ uri: definition.uri, cid: definition.cid, created: false });
    const award = await expectStored(user.client, result.award);
    expect(award.subject).toEqual({ $type: strongRef.main.$type, ...otherActivity });
    expect(
      (await expectReferencesResolve(user.client, award)).map((ref) => ref.uri).sort(),
    ).toEqual([definition.uri, otherActivity.uri].sort());
    expect(await snapshotCounts(user.client)).toEqual({
      ...before,
      badgeAward: before.badgeAward + 1,
    });
  });

  it("writes nothing when the signed-in account is not among the definition's allowed issuers", async () => {
    const definition = await createBadgeDefinition(
      user.context,
      newDefinition({ allowedIssuers: [other.did] }),
    );
    const before = await snapshotCounts(user.client);

    const error = await awardBadge(user.context, {
      definition: { uri: definition.uri },
      subject: { did: other.did },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(new RegExp(`lets only ${other.did} award it`));
    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});

describe("respondToBadgeAward", () => {
  const awardTo = (account: Account) =>
    awardBadge(user.context, { definition: newDefinition(), subject: { did: account.did } });

  it("lets the recipient accept an award, the response pinning the award's CID", async () => {
    const { award } = await awardTo(other);

    const response = await respondToBadgeAward(other.context, {
      awardUri: award.uri,
      response: "accepted",
      weight: "2.5",
    });

    expect(response.uri.startsWith(`at://${other.did}/${collections.badgeResponse}/`)).toBe(true);
    const stored = await expectStored(other.client, response);
    expect(stored).toMatchObject({ response: "accepted", weight: "2.5", badgeAward: award });
    // The award lives in `user`'s repo, so this also reads another account's record.
    expect(await expectReferencesResolve(user.client, stored)).toEqual([award]);
  });

  it("writes nothing when the issuer responds to an award made for someone else", async () => {
    const { award } = await awardTo(other);
    const before = await snapshotCounts(user.client);

    const error = await respondToBadgeAward(user.context, {
      awardUri: award.uri,
      response: "accepted",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/only the recipient can respond to a badge award/);
    expect(await snapshotCounts(user.client)).toEqual(before);
  });
});
