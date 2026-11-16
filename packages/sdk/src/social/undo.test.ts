import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods } from "../test-utils/fake-repo.js";
import { unfollowAccount, unfollowEntity, unlike, unrepost } from "./index.js";

const RKEY = "3k2a4b5c6d7e8";
const OTHER_ACCOUNT = "did:plc:other456";
const ACTIVITY_URI = `at://${DID}/org.hypercerts.claim.activity/${RKEY}`;

type Context = Parameters<typeof unlike>[0];

// Each undo function, the record it deletes, and the input field that holds that record's URI.
const actions = [
  {
    name: "unfollowAccount",
    collection: "app.certified.graph.follow",
    undo: (context: Context, input: object) => unfollowAccount(context, input as never),
    uriField: "followUri",
  },
  {
    name: "unfollowEntity",
    collection: "app.certified.graph.entityFollow",
    undo: (context: Context, input: object) => unfollowEntity(context, input as never),
    uriField: "followUri",
  },
  {
    name: "unlike",
    collection: "app.certified.feed.like",
    undo: (context: Context, input: object) => unlike(context, input as never),
    uriField: "likeUri",
  },
  {
    name: "unrepost",
    collection: "app.certified.feed.repost",
    undo: (context: Context, input: object) => unrepost(context, input as never),
    uriField: "repostUri",
  },
];

describe.each(actions)("$name", ({ collection, undo, uriField }) => {
  const uri = `at://${DID}/${collection}/${RKEY}`;

  it.each([
    ["with the CID guard when `cid` is given", { cid: CID }, CID],
    ["without a guard when `cid` is not given", {}, undefined],
  ])("deletes the record at the URI, %s, and sends nothing else", async (_, extra, swapRecord) => {
    const { context, requests } = fakeRepo({ deleteRecord: () => json(200, {}) });

    await expect(undo(context, { [uriField]: uri, ...extra })).resolves.toBeUndefined();

    expect(methods(requests)).toEqual(["com.atproto.repo.deleteRecord"]);
    const sent = JSON.parse(new TextDecoder().decode(requests[0]?.body));
    expect(sent).toEqual({ repo: DID, collection, rkey: RKEY, swapRecord });
  });
});

// The checks are shared by the four functions; each function's own field and collection are
// proved by the success cases above, so these run through `unlike` only.
describe("rejected input", () => {
  const collection = "app.certified.feed.like";
  const likeUri = `at://${DID}/${collection}/${RKEY}`;

  it.each([
    ["an unknown field", { likeUri, extra: true }, /has a field the SDK does not know/],
    ["a DID instead of a record URI", { likeUri: DID }, /must be a full record URI/],
    ["a handle authority", { likeUri: `at://alice.bsky.social/${collection}/${RKEY}` }, /DID/],
    ["a cid that is not a CID", { likeUri, cid: "not-a-cid" }, /must be a CID string/],
    [
      "the URI of the liked record, whose collection is another",
      { likeUri: ACTIVITY_URI },
      /is a org.hypercerts.claim.activity record, not a app.certified.feed.like record/,
    ],
    [
      "a record in another account's repository",
      { likeUri: `at://${OTHER_ACCOUNT}/${collection}/${RKEY}` },
      new RegExp(`is in the repository of ${OTHER_ACCOUNT}, not of the signed-in account`),
    ],
  ])("throws TypeError for %s, and sends nothing", async (_, input, message) => {
    const { context, requests } = fakeRepo();

    const error = await unlike(context, input as never).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^unlike: /);
    expect(error.message).toMatch(message);
    expect(requests).toHaveLength(0);
  });
});
