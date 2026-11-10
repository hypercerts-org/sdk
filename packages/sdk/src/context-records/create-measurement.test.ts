import { isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, DID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import {
  createMeasurement,
  type MeasurementInput,
  WriteOutcomeUnknownError,
  WriteRejectedError,
} from "./index.js";

const MEASUREMENT = "org.hypercerts.context.measurement";
const ACTIVITY = "org.hypercerts.claim.activity";
const LOCATION = "app.certified.location";

const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") => `at://${DID}/${collection}/${rkey}`;
const location = {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
};
const base = { metric: "Forest area restored", unit: "hectares", value: "1234.56" };
const APPLY = "com.atproto.repo.applyWrites";

describe("createMeasurement", () => {
  it("creates a measurement with every field, a new and an existing location, in one write", async () => {
    const activity = uriOf(ACTIVITY);
    const existingLocation = uriOf(LOCATION);
    const { context, requests, creates } = fakeRepo({
      existing: { [activity]: CID, [existingLocation]: CID },
    });

    const result = await createMeasurement(context, {
      ...base,
      subjects: [{ uri: activity }],
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-06-30T00:00:00.000Z",
      locations: [{ uri: existingLocation }, location],
      methodType: "remote-sensing",
      methodURI: "https://example.org/method",
      evidenceURI: ["https://example.org/data.csv", uriOf("org.hypercerts.claim.evidence")],
      measurers: ["did:plc:abc123", "did:plc:def456"],
      comment: "Season one.",
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    expect(methods(requests).at(-1)).toBe(APPLY);
    expect(methods(requests).filter((m) => m === APPLY)).toHaveLength(1);
    const writes = creates[0] ?? [];
    expect(writes.map((write) => write.collection)).toEqual([LOCATION, MEASUREMENT]);
    const measurement = writeOf(writes, MEASUREMENT);
    expect(isTidString(measurement.rkey)).toBe(true);
    const newLocation = refTo(writeOf(writes, LOCATION));
    expect(measurement.value).toEqual({
      $type: MEASUREMENT,
      ...base,
      subjects: [{ uri: activity, cid: CID }],
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-06-30T00:00:00.000Z",
      locations: [{ uri: existingLocation, cid: CID }, newLocation],
      methodType: "remote-sensing",
      methodURI: "https://example.org/method",
      evidenceURI: ["https://example.org/data.csv", uriOf("org.hypercerts.claim.evidence")],
      measurers: [{ did: "did:plc:abc123" }, { did: "did:plc:def456" }],
      comment: "Season one.",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      ...refTo(measurement),
      created: true,
      subjects: [{ uri: activity, cid: CID, created: false }],
      locations: [
        { uri: existingLocation, cid: CID, created: false },
        { ...newLocation, created: true },
      ],
    });
  });

  it("creates a bare measurement as a single write", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createMeasurement(context, base);

    expect(methods(requests)).toEqual([APPLY]);
    expect(creates[0]).toHaveLength(1);
    const write = writeOf(creates[0] ?? [], MEASUREMENT);
    expect(write.value.subjects).toBeUndefined();
    expect(result).toEqual({ ...refTo(write), created: true });
  });

  it.each(["0.10", "-3", "007", "12345678901234567890.123456789"])(
    "stores the value %s exactly as written",
    async (value) => {
      const { context, creates } = fakeRepo();

      await createMeasurement(context, { ...base, value });

      expect(writeOf(creates[0] ?? [], MEASUREMENT).value.value).toBe(value);
    },
  );

  it("does not modify its subjects", async () => {
    const activity = uriOf(ACTIVITY);
    const { context, creates, updates, puts } = fakeRepo({ existing: { [activity]: CID } });

    await createMeasurement(context, { ...base, subjects: [{ uri: activity }] });

    expect(creates[0]).toHaveLength(1);
    expect(updates.flat()).toEqual([]);
    expect(puts).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      "a number as the value",
      { value: 1234.56 },
      /decimal number written as a string.* at \$\.value/,
    ],
    [
      "a value with a thousands separator",
      { value: "1,234" },
      /decimal number written as a string/,
    ],
    ["a value in exponent notation", { value: "1e3" }, /decimal number written as a string/],
    ["an empty value", { value: "" }, /decimal number written as a string/],
    [
      "an end date before the start date",
      { startDate: "2026-02-01T00:00:00Z", endDate: "2026-01-01T00:00:00Z" },
      /endDate before its startDate/,
    ],
    [
      "a measurer that is not a DID",
      { measurers: ["alice.example"] },
      /Invalid DID.*measurers\[0\]/,
    ],
    [
      "a subject that is a bare string",
      { subjects: [uriOf(ACTIVITY)] },
      /subjects\[0\] must be \{ uri \} of an existing record/,
    ],
    [
      "a location URI of another record type",
      { locations: [{ uri: uriOf(ACTIVITY) }] },
      /locations\[0\] points at a record of type org\.hypercerts\.claim\.activity, but this field holds app\.certified\.location/,
    ],
    [
      "a location URI mixed with location fields",
      { locations: [{ uri: uriOf(LOCATION), ...location }] },
      /locations\[0\] combines `uri` with other fields/,
    ],
    ["a misspelled field", { metrik: "x" }, /Allowed fields: metric, unit, value/],
    [
      "a unit the lexicon rejects",
      { unit: "x".repeat(51) },
      /input is not a valid org\.hypercerts\.context\.measurement record/,
    ],
    [
      "a methodURI that is not a URI",
      { methodURI: "not a uri" },
      /input is not a valid org\.hypercerts\.context\.measurement record/,
    ],
  ])("sends nothing for %s", async (_, fields, message) => {
    const { context, requests } = fakeRepo();

    await expect(
      createMeasurement(context, { ...base, ...fields } as unknown as MeasurementInput),
    ).rejects.toThrow(message);

    expect(requests).toHaveLength(0);
  });

  it("reads existing records before writing, and writes nothing when one is missing", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createMeasurement(context, { ...base, subjects: [{ uri: uriOf(ACTIVITY) }] }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual(["com.atproto.repo.getRecord"]);
  });
});

describe("createMeasurement when the write fails", () => {
  it("reports a definite rejection and does not retry", async () => {
    const { context, requests } = fakeRepo({
      applyWrites: () => json(400, { error: "InvalidRequest", message: "Bad record" }),
    });

    const error = await createMeasurement(context, base).catch((e) => e);

    expect(error).toBeInstanceOf(WriteRejectedError);
    expect(methods(requests)).toEqual([APPLY]);
  });

  it("reports an unknown outcome with every attempted URI and does not retry", async () => {
    const { context, requests } = fakeRepo({ applyWrites: () => json(500, {}) });

    const error = await createMeasurement(context, { ...base, locations: [location] }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(WriteOutcomeUnknownError);
    const sent = JSON.parse(new TextDecoder().decode(requests[0]?.body)).writes as {
      collection: string;
      rkey: string;
    }[];
    expect(error.attempted.map((ref: { uri: string }) => ref.uri)).toEqual(
      sent.map((w) => `at://${DID}/${w.collection}/${w.rkey}`),
    );
    expect(error.attempted).toHaveLength(2);
    expect(methods(requests)).toEqual([APPLY]);
  });
});
