import { Client, isTidString } from "@atproto/lex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSDKContext } from "../context.js";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  type AcknowledgementInput,
  createAcknowledgement,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const ACKNOWLEDGEMENT = "org.hypercerts.context.acknowledgement";
const CONTRIBUTOR = "org.hypercerts.claim.contributorInformation";
const ACTIVITY = "org.hypercerts.claim.activity";
const APPLY = "com.atproto.repo.applyWrites";

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const subject = uriOf(CONTRIBUTOR);
const activity = uriOf(ACTIVITY, "3k2a4b5c6d7e9");

describe("createAcknowledgement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acknowledges a subject with a pinned context, as the signed-in account", async () => {
    const { context, requests, creates } = fakeRepo({
      existing: { [subject]: CID, [activity]: CID },
    });

    const result = await createAcknowledgement(context, {
      subject: { uri: subject },
      context: { uri: activity },
      acknowledged: true,
      comment: "Happy to be listed.",
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    // The two records are read, then one record is written to the signed-in account's repo.
    expect(methods(requests)).toEqual([
      "com.atproto.repo.getRecord",
      "com.atproto.repo.getRecord",
      APPLY,
    ]);
    const body = JSON.parse(new TextDecoder().decode(requests.at(-1)?.body));
    expect(body.repo).toBe(DID);
    expect(creates[0]).toHaveLength(1);
    const write = writeOf(creates[0] ?? [], ACKNOWLEDGEMENT);
    expect(isTidString(write.rkey)).toBe(true);
    expect(write.value).toEqual({
      $type: ACKNOWLEDGEMENT,
      subject: { uri: subject, cid: CID },
      context: { $type: "com.atproto.repo.strongRef", uri: activity, cid: CID },
      acknowledged: true,
      comment: "Happy to be listed.",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      ...refTo(write),
      created: true,
      subject: { uri: subject, cid: CID, created: false },
      context: { uri: activity, cid: CID, created: false },
    });
  });

  it("acknowledges another account's record but writes to the signed-in account's repo", async () => {
    const owner = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
    const theirs = uriOf(ACTIVITY).replace(DID, owner);
    // The owner's PDS is found from their DID document and read without the client.
    vi.stubGlobal("fetch", async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://plc.directory/")) {
        return json(200, {
          id: owner,
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://owner-pds.test",
            },
          ],
        });
      }
      return json(200, { uri: theirs, cid: CID, value: {} });
    });
    const { context, requests, creates } = fakeRepo();

    const result = await createAcknowledgement(context, {
      subject: { uri: theirs },
      acknowledged: true,
    });

    // Only the write goes through the client, and it targets the signed-in account's repo.
    expect(methods(requests)).toEqual([APPLY]);
    expect(JSON.parse(new TextDecoder().decode(requests[0]?.body)).repo).toBe(DID);
    expect(result.uri.startsWith(`at://${DID}/${ACKNOWLEDGEMENT}/`)).toBe(true);
    expect(writeOf(creates[0] ?? [], ACKNOWLEDGEMENT).value.subject).toEqual({
      uri: theirs,
      cid: CID,
    });
  });

  it("records a rejection", async () => {
    const { context, creates } = fakeRepo({ existing: { [subject]: CID } });

    const result = await createAcknowledgement(context, {
      subject: { uri: subject },
      acknowledged: false,
    });

    const { value } = writeOf(creates[0] ?? [], ACKNOWLEDGEMENT);
    expect(value).toMatchObject({ subject: { uri: subject, cid: CID }, acknowledged: false });
    expect(value.context).toBeUndefined();
    expect(value.comment).toBeUndefined();
    expect(result.context).toBeUndefined();
  });

  it("stores a context string as a URI, without reading it", async () => {
    const collection = uriOf("org.hypercerts.collection");
    const { context, requests, creates } = fakeRepo({ existing: { [subject]: CID } });

    await createAcknowledgement(context, {
      subject: { uri: subject },
      context: collection,
      acknowledged: true,
    });

    // Only the subject is read: a lightweight context has no CID to look up.
    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord", APPLY]);
    expect(writeOf(creates[0] ?? [], ACKNOWLEDGEMENT).value.context).toEqual({
      $type: "org.hypercerts.defs#uri",
      uri: collection,
    });
  });

  it("accepts a subject of any record type and does not modify it", async () => {
    const { context, creates, updates, puts } = fakeRepo({
      existing: { [activity]: CID },
    });

    await createAcknowledgement(context, { subject: { uri: activity }, acknowledged: true });

    expect(creates[0]).toHaveLength(1);
    expect(updates.flat()).toEqual([]);
    expect(puts).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a subject that is a bare string", { subject }, /must be \{ uri \}.* at \$\.subject/],
    ["no subject", { subject: undefined }, / at \$\.subject/],
    [
      "a subject with a handle authority",
      { subject: { uri: "at://alice.example/a.b/c" } },
      /subject/,
    ],
    [
      "an acknowledged that is not a boolean",
      { acknowledged: "yes" },
      /Expected boolean value type/,
    ],
    ["no acknowledged", { acknowledged: undefined }, / at \$\.acknowledged/],
    ["a context that is a number", { context: 5 }, /must be a URI string.* at \$\.context/],
    [
      "a context URI mixed with other fields",
      { context: { uri: activity, cid: CID } },
      /context combines `uri` with other fields/,
    ],
    [
      "a repo to write to",
      { repo: "did:plc:other" },
      /Allowed fields: subject, acknowledged, context/,
    ],
    [
      "a location",
      { location: { uri: activity } },
      /Allowed fields: subject, acknowledged, context/,
    ],
  ])("sends nothing for %s", async (_, fields, message) => {
    const { context, requests } = fakeRepo({ existing: { [subject]: CID } });
    const input = { subject: { uri: subject }, acknowledged: true, ...fields };

    await expect(
      createAcknowledgement(context, input as unknown as AcknowledgementInput),
    ).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a context string that is not a URI", { context: "not a uri" }],
    ["a comment over the lexicon's limit", { comment: "x".repeat(10_001) }],
  ])("writes nothing for %s", async (_, fields) => {
    const { context, requests } = fakeRepo({ existing: { [subject]: CID } });
    const input = { subject: { uri: subject }, acknowledged: true, ...fields };

    await expect(createAcknowledgement(context, input)).rejects.toThrow(
      /input is not a valid org\.hypercerts\.context\.acknowledgement record/,
    );

    // The subject was read to build its reference, but nothing was written.
    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("writes nothing when the subject cannot be resolved", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createAcknowledgement(context, { subject: { uri: subject }, acknowledged: true }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("fails before sending anything when the client is not authenticated", async () => {
    const requests: string[] = [];
    const client = new Client({
      fetchHandler: async (path) => {
        requests.push(path);
        return json(200, {});
      },
    });

    await expect(
      createAcknowledgement(createSDKContext({ client }), {
        subject: { uri: subject },
        acknowledged: true,
      }),
    ).rejects.toThrow(/createAcknowledgement: the client is not authenticated/);

    expect(requests).toEqual([]);
  });
});

describe("createAcknowledgement when the write fails", () => {
  const input = { subject: { uri: subject }, acknowledged: true };

  it("reports a definite rejection and does not retry", async () => {
    const { context, requests } = fakeRepo({
      existing: { [subject]: CID },
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createAcknowledgement(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(methods(requests).filter((m) => m === APPLY)).toHaveLength(1);
  });

  it("reports an unknown outcome with the attempted URI and does not retry", async () => {
    const { context, requests } = fakeRepo({
      existing: { [subject]: CID },
      applyWrites: () => json(500, {}),
    });

    const error = await createAcknowledgement(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    const sent = JSON.parse(new TextDecoder().decode(requests.at(-1)?.body)).writes[0] as {
      collection: string;
      rkey: string;
    };
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual([
      `at://${DID}/${sent.collection}/${sent.rkey}`,
    ]);
    expect(methods(requests).filter((m) => m === APPLY)).toHaveLength(1);
  });
});
