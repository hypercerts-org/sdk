import { type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  type RespondToBadgeAwardInput,
  respondToBadgeAward,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const AWARD = "app.certified.badge.award";
const RESPONSE = "app.certified.badge.response";
const ACTIVITY = "org.hypercerts.claim.activity";
// The issuer's repository is another account's, so the award is read from the PDS in its DID
// document, as it is outside tests.
const ISSUER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const OTHER = "did:plc:other222";
const awardUri = `at://${ISSUER}/${AWARD}/3k2a4b5c6d7e8`;
const ownRecordUri = `at://${DID}/${ACTIVITY}/3k2a4b5c6d7e8`;

const forDid = (did: string) => ({ $type: "app.certified.defs#did", did });
const forRecord = (uri: string) => ({ $type: "com.atproto.repo.strongRef", uri, cid: CID });
const storedAward = (subject: LexMap): LexMap => ({
  $type: AWARD,
  badge: { uri: `at://${ISSUER}/app.certified.badge.definition/3k2a4b5c6d7e8`, cid: CID },
  subject,
  createdAt: "2024-01-01T00:00:00.000Z",
});
const cidOf = async (value: LexMap) =>
  (await cidForLex(lexParse(JSON.stringify(value)))).toString();

// Serves the issuer's DID document and the records of its repository, and counts the reads.
function stubIssuerPds(records: Record<string, LexMap>) {
  const reads: string[] = [];
  vi.stubGlobal("fetch", async (input: Request | string | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://plc.directory") {
      return json(200, {
        id: ISSUER,
        service: [
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://issuer-pds.test",
          },
        ],
      });
    }
    const uri = `at://${url.searchParams.get("repo")}/${url.searchParams.get("collection")}/${url.searchParams.get("rkey")}`;
    reads.push(uri);
    const value = records[uri];
    return value === undefined
      ? json(400, { error: "RecordNotFound", message: "not found" })
      : json(200, { uri, cid: await cidOf(value), value });
  });
  return reads;
}

const respond = (input: Partial<RespondToBadgeAwardInput> = {}): RespondToBadgeAwardInput => ({
  awardUri,
  response: "accepted",
  ...input,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("respondToBadgeAward", () => {
  it.each([
    ["an account", forDid(DID)],
    ["a record in the signed-in account's repository", forRecord(ownRecordUri)],
  ])(
    "creates the response when the award is for %s, keeping the weight as written",
    async (_, subject) => {
      const award = storedAward(subject);
      stubIssuerPds({ [awardUri]: award });
      const { context, requests, creates, swapCommits } = fakeRepo();

      const ref = await respondToBadgeAward(
        context,
        respond({ weight: "007.50", createdAt: "2024-05-05T12:00:00.000Z" }),
      );

      // The award is read from the issuer's PDS; the signed-in account's PDS only gets the write.
      expect(methods(requests)).toEqual(["com.atproto.repo.applyWrites"]);
      const write = writeOf(creates[0] ?? [], RESPONSE);
      expect(creates[0]).toHaveLength(1);
      expect(write.value).toEqual({
        $type: RESPONSE,
        badgeAward: { uri: awardUri, cid: await cidOf(award) },
        response: "accepted",
        weight: "007.50",
        createdAt: "2024-05-05T12:00:00.000Z",
      });
      expect(swapCommits).toEqual([undefined]);
      expect(ref).toEqual(refTo(write));
    },
  );

  it("records a rejection without a weight, and a second call creates a second response", async () => {
    stubIssuerPds({ [awardUri]: storedAward(forDid(DID)) });
    const { context, creates } = fakeRepo();

    const first = await respondToBadgeAward(context, respond({ response: "rejected" }));
    const second = await respondToBadgeAward(context, respond({ response: "rejected" }));

    const value = writeOf(creates[0] ?? [], RESPONSE).value;
    expect(value).toMatchObject({ response: "rejected" });
    expect(value).not.toHaveProperty("weight");
    // Nothing is deduplicated or overwritten: a new record under a new key each time.
    expect(first.uri).not.toBe(second.uri);
    expect(creates).toHaveLength(2);
  });

  it.each([
    [
      "an account",
      forDid(OTHER),
      /is for did:plc:other222 and the client is signed in as did:plc:testowner123/,
    ],
    [
      "a record in another account's repository",
      forRecord(`at://${OTHER}/${ACTIVITY}/3k2a4b5c6d7e8`),
      /is for did:plc:other222 and the client is signed in as/,
    ],
  ])(
    "refuses to respond to an award for %s that is not the signed-in account's",
    async (_, subject, message) => {
      stubIssuerPds({ [awardUri]: storedAward(subject) });
      const { context, requests } = fakeRepo();

      const error = await respondToBadgeAward(context, respond()).catch((e) => e);

      expect(error.message).toMatch(/only the recipient can respond/);
      expect(error.message).toMatch(message);
      expect(requests).toHaveLength(0);
    },
  );

  it("does not let the issuer respond to an award they made for someone else", async () => {
    const own = `at://${DID}/${AWARD}/3k2a4b5c6d7e8`;
    const { context, requests } = fakeRepo({ records: { [own]: storedAward(forDid(OTHER)) } });

    await expect(respondToBadgeAward(context, respond({ awardUri: own }))).rejects.toThrow(
      /only the recipient can respond/,
    );

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it.each<[string, Partial<RespondToBadgeAwardInput> | Record<string, unknown>, RegExp]>([
    [
      "a weight on a rejected award",
      { response: "rejected", weight: "1" },
      /has a weight on a rejected award.* at \$\.weight/,
    ],
    [
      "a weight that is not a positive decimal",
      { weight: "heavy" },
      /positive decimal number.* at \$\.weight/,
    ],
    [
      "a response other than accepted or rejected",
      { response: "maybe" },
      /Expected one of "accepted" or "rejected"/,
    ],
    ["an unknown field", { note: "hi" }, /has a field the SDK does not know/],
    [
      "an award URI of another type of record",
      { awardUri: ownRecordUri },
      /must be of type app.certified.badge.award/,
    ],
    [
      "an award URI with a handle",
      { awardUri: `at://alice.test/${AWARD}/3k2a4b5c6d7e8` },
      /not a record URI/,
    ],
  ])("sends nothing for %s", async (_, bad, message) => {
    const reads = stubIssuerPds({ [awardUri]: storedAward(forDid(DID)) });
    const { context, requests } = fakeRepo();

    const error = await respondToBadgeAward(context, { ...respond(), ...bad } as never).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(message);
    expect([requests.length, reads.length]).toEqual([0, 0]);
  });

  it("rejects a weight the lexicon does not allow without writing", async () => {
    stubIssuerPds({ [awardUri]: storedAward(forDid(DID)) });
    const { context, requests } = fakeRepo();

    const error = await respondToBadgeAward(context, respond({ weight: "1".repeat(51) })).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/the response is not a valid app.certified.badge.response/);
    expect(requests).toHaveLength(0);
  });

  it.each<[string, Record<string, LexMap>, RegExp]>([
    ["an award that does not exist", {}, /cannot resolve .*the record was not found/],
    [
      "an award that is not valid",
      { [awardUri]: { $type: AWARD, subject: forDid(DID) } },
      /is not a valid app.certified.badge.award record.*does not respond to it/,
    ],
    [
      "an award for something that is neither an account nor a record",
      { [awardUri]: storedAward({ $type: "example.app.thing", id: "1" }) },
      /neither an account \(app.certified.defs#did\) nor a record \(com.atproto.repo.strongRef\)/,
    ],
    [
      "an award for a record named by handle",
      { [awardUri]: storedAward(forRecord(`at://alice.test/${ACTIVITY}/3k2a4b5c6d7e8`)) },
      /does not name its repository by DID, so the SDK cannot tell who its recipient is/,
    ],
  ])("does not write for %s", async (_, records, message) => {
    stubIssuerPds(records);
    const { context, requests } = fakeRepo();

    await expect(respondToBadgeAward(context, respond())).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });
});

describe("respondToBadgeAward when the write fails", () => {
  it("reports a rejected write as definite, and a write without an answer as unknown without retrying", async () => {
    stubIssuerPds({ [awardUri]: storedAward(forDid(DID)) });
    const rejecting = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "no" }),
    });
    const silent = fakeRepo({ applyWrites: () => json(500, {}) });

    const rejected = await respondToBadgeAward(rejecting.context, respond()).catch((e) => e);
    const unknown = await respondToBadgeAward(silent.context, respond()).catch((e) => e);

    expect(rejected).toBeInstanceOf(WriteRejectedError);
    expect(unknown).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(unknown.attempted).toHaveLength(1);
    expect(unknown.attempted[0].uri).toMatch(new RegExp(`^at://${DID}/${RESPONSE}/`));
    expect(unknown.message).toContain(unknown.attempted[0].uri);
    expect(methods(silent.requests)).toEqual(["com.atproto.repo.applyWrites"]);
  });
});
