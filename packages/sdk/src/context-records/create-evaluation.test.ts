import { isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { uriOf } from "../test-utils/records.js";
import {
  createEvaluation,
  type EvaluationInput,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const EVALUATION = "org.hypercerts.context.evaluation";
const MEASUREMENT = "org.hypercerts.context.measurement";
const ACTIVITY = "org.hypercerts.claim.activity";
const LOCATION = "app.certified.location";
const APPLY = "com.atproto.repo.applyWrites";
const UPLOAD = "com.atproto.repo.uploadBlob";

const location = (name: string) => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
  name,
});
const base = { evaluators: [{ did: "did:plc:abc123" }], summary: "Meets its targets." };
const measurement = { metric: "Forest area restored", unit: "hectares", value: "1234.56" };

describe("createEvaluation", () => {
  it("creates an evaluation with new and existing measurements, a new location and every field in one write", async () => {
    const activity = uriOf(ACTIVITY);
    const existingMeasurement = uriOf(MEASUREMENT);
    const { context, requests, creates, updates } = fakeRepo({
      existing: { [activity]: CID, [existingMeasurement]: CID },
    });

    const result = await createEvaluation(context, {
      evaluators: [{ did: "did:plc:abc123" }, { did: "did:plc:def456" }],
      summary: "Meets its targets.",
      subject: { uri: activity },
      content: [new Blob(["report"], { type: "application/pdf" }), "https://example.org/report"],
      measurements: [
        {
          ...measurement,
          value: "0.10",
          measurers: ["did:plc:abc123"],
          locations: [location("plot")],
        },
        { uri: existingMeasurement },
      ],
      score: { min: "0", max: "5", value: "4.2" },
      location: location("site"),
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    // Existing records are read, the file is uploaded, then everything is written in one request.
    const sent = methods(requests);
    expect(sent.filter((m) => m === APPLY)).toHaveLength(1);
    expect(sent.at(-1)).toBe(APPLY);
    expect(sent.indexOf(UPLOAD)).toBeGreaterThan(-1);
    expect(updates.flat()).toEqual([]);
    const writes = creates[0] ?? [];
    // The measurement's location, the measurement, the evaluation's location, then the Evaluation.
    expect(writes.map((write) => write.collection)).toEqual([
      LOCATION,
      MEASUREMENT,
      LOCATION,
      EVALUATION,
    ]);
    const [plot, newMeasurement, site] = writes.slice(0, 3).map(refTo);
    // The nested measurement is built as createMeasurement builds one: a TID key, the value as written.
    expect(isTidString(writes[1]?.rkey)).toBe(true);
    expect(writes[1]?.value).toEqual({
      $type: MEASUREMENT,
      ...measurement,
      value: "0.10",
      measurers: [{ did: "did:plc:abc123" }],
      locations: [plot],
      // A nested record's createdAt is the time of the call, not the Evaluation's own createdAt.
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    const evaluation = writeOf(writes, EVALUATION);
    expect(isTidString(evaluation.rkey)).toBe(true);
    expect(evaluation.value).toEqual({
      $type: EVALUATION,
      evaluators: [{ did: "did:plc:abc123" }, { did: "did:plc:def456" }],
      summary: "Meets its targets.",
      subject: { uri: activity, cid: CID },
      content: [
        {
          $type: "org.hypercerts.defs#smallBlob",
          blob: { $type: "blob", ref: expect.anything(), mimeType: "application/pdf", size: 6 },
        },
        { $type: "org.hypercerts.defs#uri", uri: "https://example.org/report" },
      ],
      measurements: [newMeasurement, { uri: existingMeasurement, cid: CID }],
      score: { min: "0", max: "5", value: "4.2" },
      location: site,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      ...refTo(evaluation),
      subject: { uri: activity, cid: CID, created: false },
      measurements: [
        { ...newMeasurement, created: true, locations: [{ ...plot, created: true }] },
        { uri: existingMeasurement, cid: CID, created: false },
      ],
      location: { ...site, created: true },
    });
  });

  it("creates a bare evaluation as a single write", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createEvaluation(context, base);

    expect(methods(requests)).toEqual([APPLY]);
    expect(creates[0]).toHaveLength(1);
    const write = writeOf(creates[0] ?? [], EVALUATION);
    expect(write.value).toEqual({
      $type: EVALUATION,
      evaluators: [{ did: "did:plc:abc123" }],
      summary: "Meets its targets.",
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    expect(result).toEqual(refTo(write));
  });

  it.each<[string, { min: string; max: string; value: string }]>([
    ["the minimum", { min: "0", max: "5", value: "0" }],
    ["the maximum", { min: "0", max: "5", value: "5" }],
    ["trailing zeros", { min: "0.10", max: "5", value: "0.1" }],
    ["a negative scale", { min: "-5", max: "5", value: "-4.5" }],
  ])("accepts a score at %s", async (_, score) => {
    const { context, creates } = fakeRepo();

    await createEvaluation(context, { ...base, score });

    expect(writeOf(creates[0] ?? [], EVALUATION).value.score).toEqual(score);
  });

  it.each<[string, { min: string; max: string; value: string }]>([
    ["above the maximum", { min: "0", max: "5", value: "5.01" }],
    ["below the minimum", { min: "0", max: "5", value: "-0.01" }],
    ["below a negative minimum", { min: "-5", max: "5", value: "-5.5" }],
    [
      "above a 20-digit maximum by one in the last place",
      { min: "0", max: "12345678901234567890.1", value: "12345678901234567890.2" },
    ],
  ])("rejects a score %s", async (_, score) => {
    const { context, requests } = fakeRepo();

    await expect(createEvaluation(context, { ...base, score })).rejects.toThrow(
      /must have a value from min to max/,
    );

    expect(requests).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["no evaluators", { evaluators: undefined }, / at \$\.evaluators/],
    [
      "an evaluator that is not a DID",
      { evaluators: [{ did: "alice.example" }] },
      /Invalid DID.*evaluators\[0\]/,
    ],
    [
      "a score with a number",
      { score: { min: "0", max: "5", value: 3 } },
      /decimal number written as a string/,
    ],
    ["a score missing its max", { score: { min: "0", value: "3" } }, /max/],
  ])("sends nothing for %s", async (_, fields, message) => {
    const { context, requests } = fakeRepo();

    await expect(
      createEvaluation(context, { ...base, ...fields } as unknown as EvaluationInput),
    ).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });
});

describe("createEvaluation when the write fails", () => {
  const input: EvaluationInput = {
    ...base,
    measurements: [{ ...measurement, locations: [location("plot")] }],
  };

  it("reports a definite rejection and does not retry", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createEvaluation(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(error.message).toMatch(/the 3 records were not created/);
    expect(methods(requests)).toEqual([APPLY]);
  });

  it("reports an unknown outcome with every attempted URI and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createEvaluation(context, input).catch((e) => e);

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    // Record keys are TIDs chosen per call, so calling again after a write that succeeded duplicates.
    expect(error.message).toMatch(/would create duplicates with new record keys/);
    const sent = JSON.parse(new TextDecoder().decode(requests[0]?.body)).writes as {
      collection: string;
      rkey: string;
    }[];
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual(
      sent.map((w) => `at://${DID}/${w.collection}/${w.rkey}`),
    );
    expect(error.attempted).toHaveLength(3);
    expect(methods(requests)).toEqual([APPLY]);
  });
});
