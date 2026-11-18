import * as acknowledgement from "@hypercerts-org/lexicon/org/hypercerts/context/acknowledgement";
import * as attachment from "@hypercerts-org/lexicon/org/hypercerts/context/attachment";
import * as evaluation from "@hypercerts-org/lexicon/org/hypercerts/context/evaluation";
import * as measurement from "@hypercerts-org/lexicon/org/hypercerts/context/measurement";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/activity/index.js";
import {
  createAcknowledgement,
  createAttachment,
  createEvaluation,
  createMeasurement,
} from "../src/context-records/index.js";
import { readE2eEnv } from "./env.js";
import { coordinates, unique } from "./fixtures.js";
import { redirectPlcDirectory } from "./plc.js";
import {
  blobIn,
  collections,
  countRecords,
  defined,
  deleteStored,
  expectBlobServed,
  expectReferencesResolve,
  expectStored,
  type Ref,
} from "./records.js";
import { type Account, loginAs } from "./session.js";

const contexts = {
  attachment: attachment.main.$type,
  measurement: measurement.main.$type,
  evaluation: evaluation.main.$type,
  acknowledgement: acknowledgement.main.$type,
} as const;

// `user` writes. `other` owns the Activity the records are about: a record of another account is
// what an application's users attach evidence to, and it is read from that account's own PDS.
let user: Account;
let other: Account;
let target: Ref;

beforeAll(async () => {
  redirectPlcDirectory(readE2eEnv().plcUrl);
  [user, other] = await Promise.all([loginAs("user1"), loginAs("user2")]);
  expect(other.did, "SDK_E2E_USER2 must be a different account than SDK_E2E_USER1").not.toBe(
    user.did,
  );
  const activity = await createActivity(other.context, {
    title: unique("E2E activity"),
    shortDescription: "Planting native trees",
  });
  target = { uri: activity.uri, cid: activity.cid };
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteStored(other.client, target.uri);
});

// A record of `other` that was never written.
const missingUri = () => `at://${other.did}/${collections.activity}/${unique("missing", "-")}`;

// Reads a record the SDK reported, after checking it is in the signed-in account's repo and in
// `collection`, and returns what is stored. Every strong reference in it must resolve.
async function storedOwn(ref: Ref, collection: string) {
  expect(ref.uri.startsWith(`at://${user.did}/${collection}/`)).toBe(true);
  const stored = await expectStored(user.client, ref);
  await expectReferencesResolve(user.client, stored);
  return stored;
}

describe("createAttachment", () => {
  it("stores the attachment with its subject pinned and the uploaded file served", async () => {
    const bytes = new TextEncoder().encode(unique("survey"));

    const result = await createAttachment(user.context, {
      title: unique("E2E attachment"),
      subjects: [{ uri: target.uri }],
      content: [new File([bytes], "survey.txt", { type: "text/plain" }), "https://example.org/s"],
      location: coordinates,
    });

    const stored = await storedOwn(result, contexts.attachment);
    expect(stored.subjects).toEqual([target]);
    const [file, link] = defined(stored.content as unknown[] | undefined);
    await expectBlobServed(user.client, user.did, blobIn(file, "blob"), bytes);
    expect(link).toMatchObject({ $type: defs.uri.$type, uri: "https://example.org/s" });
    // The location is a new record the attachment points at.
    expect(defined(result.location).created).toBe(true);
    await expectStored(user.client, defined(result.location));
  });

  it("stores a description that is a Leaflet document or points at an existing record", async () => {
    const document = { $type: "pub.leaflet.pages.linearDocument" as const, blocks: [] };
    const asDocument = await createAttachment(user.context, {
      title: unique("E2E attachment"),
      description: document,
    });
    const asReference = await createAttachment(user.context, {
      title: unique("E2E attachment"),
      description: { uri: target.uri },
    });

    expect(await expectStored(user.client, asDocument)).toMatchObject({ description: document });
    const stored = await storedOwn(asReference, contexts.attachment);
    expect(stored.description).toEqual({
      $type: "com.atproto.repo.strongRef",
      uri: target.uri,
      cid: target.cid,
    });
  });

  it("throws and writes nothing, not even its new location, when a subject cannot be read", async () => {
    const before = await countRecords(user.client, contexts.attachment);
    const locations = await countRecords(user.client, collections.location);

    await expect(
      createAttachment(user.context, {
        title: unique("E2E attachment"),
        subjects: [{ uri: missingUri() }],
        location: coordinates,
      }),
    ).rejects.toThrow(/cannot resolve/);

    expect(await countRecords(user.client, contexts.attachment)).toBe(before);
    expect(await countRecords(user.client, collections.location)).toBe(locations);
  });
});

describe("createMeasurement", () => {
  it("stores the measurement with its subject pinned and the measurers as DIDs", async () => {
    const result = await createMeasurement(user.context, {
      metric: "Forest area restored",
      unit: "hectares",
      value: "1234.56",
      subjects: [{ uri: target.uri }],
      measurers: [other.did],
    });

    const stored = await storedOwn(result, contexts.measurement);
    expect(stored).toMatchObject({ value: "1234.56", subjects: [target] });
    expect(stored.measurers).toEqual([{ did: other.did }]);
  });

  it("throws and writes nothing when a subject cannot be read", async () => {
    const before = await countRecords(user.client, contexts.measurement);

    await expect(
      createMeasurement(user.context, {
        metric: "Forest area restored",
        unit: "hectares",
        value: "1",
        subjects: [{ uri: missingUri() }],
      }),
    ).rejects.toThrow(/cannot resolve/);

    expect(await countRecords(user.client, contexts.measurement)).toBe(before);
  });
});

describe("createEvaluation", () => {
  it("stores the evaluation with its subject, a new measurement and the uploaded file", async () => {
    const bytes = new TextEncoder().encode(unique("report"));

    const result = await createEvaluation(user.context, {
      evaluators: [user.did],
      summary: unique("Meets its targets"),
      subject: { uri: target.uri },
      content: [new File([bytes], "report.pdf", { type: "application/pdf" })],
      measurements: [{ metric: "Trees planted", unit: "trees", value: "500" }],
      score: { min: "0", max: "5", value: "4.2" },
    });

    const stored = await storedOwn(result, contexts.evaluation);
    expect(stored).toMatchObject({ subject: target, score: { min: "0", max: "5", value: "4.2" } });
    const [file] = defined(stored.content as unknown[] | undefined);
    await expectBlobServed(user.client, user.did, blobIn(file, "blob"), bytes);
    // The new measurement is stored too, and the evaluation points at it by the CID it has.
    const created = defined(result.measurements?.[0]);
    expect(created.created).toBe(true);
    expect(stored.measurements).toEqual([{ uri: created.uri, cid: created.cid }]);
  });

  it("throws and writes nothing, not even its new measurement, when the subject cannot be read", async () => {
    const evaluations = await countRecords(user.client, contexts.evaluation);
    const measurements = await countRecords(user.client, contexts.measurement);

    await expect(
      createEvaluation(user.context, {
        evaluators: [user.did],
        summary: "Meets its targets",
        subject: { uri: missingUri() },
        measurements: [{ metric: "Trees planted", unit: "trees", value: "500" }],
      }),
    ).rejects.toThrow(/cannot resolve/);

    expect(await countRecords(user.client, contexts.evaluation)).toBe(evaluations);
    expect(await countRecords(user.client, contexts.measurement)).toBe(measurements);
  });
});

describe("createAcknowledgement", () => {
  it("stores the subject and a `{ uri }` context as strong references", async () => {
    const result = await createAcknowledgement(user.context, {
      subject: { uri: target.uri },
      acknowledged: true,
      context: { uri: target.uri },
    });

    const stored = await storedOwn(result, contexts.acknowledgement);
    expect(stored).toMatchObject({ acknowledged: true, subject: target });
    expect(stored.context).toMatchObject(target);
  });

  // A context given as a string is a plain URI: stored as given, never looked up.
  it("stores a string context as given, even if nothing is there", async () => {
    const context = missingUri();

    const result = await createAcknowledgement(user.context, {
      subject: { uri: target.uri },
      acknowledged: false,
      context,
    });

    const stored = await storedOwn(result, contexts.acknowledgement);
    expect(stored.context).toEqual({ $type: defs.uri.$type, uri: context });
  });

  it("throws and writes nothing when the subject cannot be read", async () => {
    const before = await countRecords(user.client, contexts.acknowledgement);

    await expect(
      createAcknowledgement(user.context, { subject: { uri: missingUri() }, acknowledged: true }),
    ).rejects.toThrow(/cannot resolve/);

    expect(await countRecords(user.client, contexts.acknowledgement)).toBe(before);
  });
});
