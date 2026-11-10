import { isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
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

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const location = (name: string) => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
  name,
});
const base = { evaluators: ["did:plc:abc123"], summary: "Meets its targets." };
const measurement = { metric: "Forest area restored", unit: "hectares", value: "1234.56" };

describe("createEvaluation", () => {
  it("creates an evaluation with new and existing measurements, a new location and every field in one write", async () => {
    const activity = uriOf(ACTIVITY);
    const existingMeasurement = uriOf(MEASUREMENT);
    const { context, requests, creates, updates } = fakeRepo({
      existing: { [activity]: CID, [existingMeasurement]: CID },
    });

    const result = await createEvaluation(context, {
      evaluators: ["did:plc:abc123", "did:plc:def456"],
      summary: "Meets its targets.",
      subject: { uri: activity },
      content: [new Blob(["report"], { type: "application/pdf" }), "https://example.org/report"],
      measurements: [
        { ...measurement, measurers: ["did:plc:abc123"], locations: [location("plot")] },
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
    expect(writes[1]?.value).toEqual({
      $type: MEASUREMENT,
      ...measurement,
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
      created: true,
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
    expect(result).toEqual({ ...refTo(write), created: true });
  });

  it("only reuses existing measurements, without writing them", async () => {
    const [first, second] = [
      uriOf(MEASUREMENT, "3k2a4b5c6d7e7"),
      uriOf(MEASUREMENT, "3k2a4b5c6d7e9"),
    ];
    const { context, creates } = fakeRepo({ existing: { [first]: CID, [second]: CID } });

    const result = await createEvaluation(context, {
      ...base,
      measurements: [{ uri: first }, { uri: second }],
    });

    expect(creates[0]).toHaveLength(1);
    expect(writeOf(creates[0] ?? [], EVALUATION).value.measurements).toEqual([
      { uri: first, cid: CID },
      { uri: second, cid: CID },
    ]);
    expect(result.measurements).toEqual([
      { uri: first, cid: CID, created: false },
      { uri: second, cid: CID, created: false },
    ]);
  });

  it("reuses an existing location by URI without writing it", async () => {
    const existingLocation = uriOf(LOCATION);
    const { context, creates } = fakeRepo({ existing: { [existingLocation]: CID } });

    const result = await createEvaluation(context, {
      ...base,
      location: { uri: existingLocation },
    });

    expect(creates[0]).toHaveLength(1);
    expect(writeOf(creates[0] ?? [], EVALUATION).value.location).toEqual({
      uri: existingLocation,
      cid: CID,
    });
    expect(result.location).toEqual({ uri: existingLocation, cid: CID, created: false });
  });

  it("builds a nested measurement as createMeasurement does", async () => {
    const { context, creates } = fakeRepo();

    await createEvaluation(context, { ...base, measurements: [{ ...measurement, value: "0.10" }] });

    // Same record shape, key type and value handling as the standalone creator.
    const written = writeOf(creates[0] ?? [], MEASUREMENT);
    expect(isTidString(written.rkey)).toBe(true);
    expect(written.value.value).toBe("0.10");
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
  ])("rejects a score %s", async (_, score) => {
    const { context, requests } = fakeRepo();

    await expect(createEvaluation(context, { ...base, score })).rejects.toThrow(
      /must have a value from min to max/,
    );

    expect(requests).toHaveLength(0);
  });

  it("does not lose precision comparing long scores", async () => {
    const { context } = fakeRepo();
    const score = { min: "0", max: "12345678901234567890.1", value: "12345678901234567890.2" };

    await expect(createEvaluation(context, { ...base, score })).rejects.toThrow(
      /must have a value from min to max/,
    );
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["no evaluators", { evaluators: undefined }, / at \$\.evaluators/],
    [
      "an evaluator that is not a DID",
      { evaluators: ["alice.example"] },
      /Invalid DID.*evaluators\[0\]/,
    ],
    [
      "a score with a number",
      { score: { min: "0", max: "5", value: 3 } },
      /decimal number written as a string/,
    ],
    ["a score missing its max", { score: { min: "0", value: "3" } }, /max/],
    ["a score on a reversed scale", { score: { min: "5", max: "0", value: "3" } }, /min to max/],
    ["a subject that is a bare string", { subject: uriOf(ACTIVITY) }, /subject must be \{ uri \}/],
    [
      "a measurement URI of another record type",
      { measurements: [{ uri: uriOf(ACTIVITY) }] },
      /measurements\[0\] points at a record of type org\.hypercerts\.claim\.activity, but this field holds org\.hypercerts\.context\.measurement/,
    ],
    [
      "a measurement URI mixed with measurement fields",
      { measurements: [{ uri: uriOf(MEASUREMENT), ...measurement }] },
      /measurements\[0\] combines `uri` with other fields/,
    ],
    [
      "a new measurement with a number value",
      { measurements: [{ ...measurement, value: 5 }] },
      /decimal number written as a string/,
    ],
    [
      "a new measurement with a misspelled field",
      { measurements: [{ ...measurement, metrik: "x" }] },
      /measurements\[0\].*Allowed fields: metric, unit, value/,
    ],
    [
      "a new location of the wrong shape",
      { location: { ...location("x"), location: { url: "https://example.org" } } },
      /location.*must be \{ uri: string \}/,
    ],
    [
      "a location URI of another record type",
      { location: { uri: uriOf(MEASUREMENT) } },
      /location points at a record of type org\.hypercerts\.context\.measurement, but this field holds app\.certified\.location/,
    ],
    ["a misspelled field", { sumary: "x" }, /Allowed fields: evaluators, summary, content/],
    [
      "a summary the lexicon rejects",
      { summary: "x".repeat(5001) },
      /input is not a valid org\.hypercerts\.context\.evaluation record/,
    ],
  ])("sends nothing for %s", async (_, fields, message) => {
    const { context, requests } = fakeRepo();

    await expect(
      createEvaluation(context, { ...base, ...fields } as unknown as EvaluationInput),
    ).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("reads existing measurements before uploading, and writes nothing when one is missing", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createEvaluation(context, {
        ...base,
        content: [new Blob(["x"], { type: "application/pdf" })],
        measurements: [{ uri: uriOf(MEASUREMENT) }],
      }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });

  it("does not write when an upload fails", async () => {
    const { context, requests } = fakeRepo({ uploadBlob: () => json(500, { error: "Internal" }) });

    await expect(
      createEvaluation(context, {
        ...base,
        measurements: [measurement],
        content: [new Blob(["x"], { type: "application/pdf" })],
      }),
    ).rejects.toThrow(/createEvaluation: could not upload input\.content\[0\]/);

    expect(methods(requests)).toEqual([UPLOAD]);
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
