import { isTidString } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { CID, json } from "../test-utils/fake-pds.js";
import { fakeRepo, methods, refTo, writeOf } from "../test-utils/fake-repo.js";
import { uriOf } from "../test-utils/records.js";
import {
  type AttachmentInput,
  createAttachment,
  type LeafletDocument,
  RecordAlreadyExistsError,
} from "./index.js";

const ATTACHMENT = "org.hypercerts.context.attachment";
const ACTIVITY = "org.hypercerts.claim.activity";
const VOCAB = "org.hypercerts.vocab.tag";
const WORKSCOPE = "org.hypercerts.workscope.tag";
const LOCATION = "app.certified.location";
const LEAFLET = "pub.leaflet.pages.linearDocument";

const tag = (category: string, key: string) => ({ category, key, name: key, status: "accepted" });
const location = {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "27.47,90.17" },
};
const pdf = () => new Blob(["report"], { type: "application/pdf" });
const GET_RECORD = "com.atproto.repo.getRecord";
const UPLOAD = "com.atproto.repo.uploadBlob";
const APPLY = "com.atproto.repo.applyWrites";

describe("createAttachment", () => {
  it("creates an attachment with subjects, content, a new location and new and existing tags in one write", async () => {
    const activity = uriOf(ACTIVITY);
    const existingTag = uriOf(VOCAB, "land-cover.wetland");
    const { context, requests, creates, updates } = fakeRepo({
      existing: { [activity]: CID, [existingTag]: CID },
    });

    const result = await createAttachment(context, {
      title: "Field survey",
      subjects: [{ uri: activity }],
      contentType: "evidence",
      content: [pdf(), "https://example.org/survey"],
      shortDescription: "June survey",
      description: "# Findings",
      langs: ["en"],
      location,
      tags: [
        { ...tag("evidence-kind", "survey"), broader: [tag("evidence-kind", "all")] },
        { uri: existingTag },
      ],
      capturedAt: "2026-06-12T09:30:00+06:00",
      createdAt: "2026-06-13T00:00:00.000Z",
    });

    // Existing records are read, the file is uploaded, then everything is written in one request.
    expect(methods(requests).sort()).toEqual(
      [GET_RECORD, GET_RECORD, GET_RECORD, GET_RECORD, UPLOAD, APPLY].sort(),
    );
    expect(methods(requests).at(-1)).toBe(APPLY);
    expect(methods(requests).indexOf(UPLOAD)).toBeLessThan(methods(requests).indexOf(APPLY));
    expect(updates.flat()).toEqual([]);
    const writes = creates[0] ?? [];
    // The location, the tags with a tag's broader tag first, then the Attachment.
    expect(writes.map((write) => write.collection)).toEqual([LOCATION, VOCAB, VOCAB, ATTACHMENT]);
    const attachment = writeOf(writes, ATTACHMENT);
    expect(isTidString(attachment.rkey)).toBe(true);
    const [newLocation, , survey] = writes.slice(0, 3).map(refTo);
    expect(attachment.value).toEqual({
      $type: ATTACHMENT,
      title: "Field survey",
      subjects: [{ uri: activity, cid: CID }],
      contentType: "evidence",
      content: [
        {
          $type: "org.hypercerts.defs#smallBlob",
          blob: { $type: "blob", ref: expect.anything(), mimeType: "application/pdf", size: 6 },
        },
        { $type: "org.hypercerts.defs#uri", uri: "https://example.org/survey" },
      ],
      shortDescription: "June survey",
      description: { $type: "org.hypercerts.defs#descriptionString", value: "# Findings" },
      langs: ["en"],
      location: newLocation,
      tags: [survey, { uri: existingTag, cid: CID }],
      capturedAt: "2026-06-12T09:30:00+06:00",
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    expect(result).toEqual({
      ...refTo(attachment),
      subjects: [{ uri: activity, cid: CID, created: false }],
      location: { ...newLocation, created: true },
      tags: [
        {
          ...survey,
          created: true,
          broader: [{ ...refTo(writes[1] ?? attachment), created: true }],
        },
        { uri: existingTag, cid: CID, created: false },
      ],
    });
  });

  it("creates an attachment with no subject, no content and nothing else as a single write", async () => {
    const { context, requests, creates } = fakeRepo();

    const result = await createAttachment(context, { title: "Baseline photos" });

    expect(methods(requests)).toEqual([APPLY]);
    expect(creates[0]).toHaveLength(1);
    const write = writeOf(creates[0] ?? [], ATTACHMENT);
    expect(write.value).toEqual({
      $type: ATTACHMENT,
      title: "Baseline photos",
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    expect(result).toEqual(refTo(write));
  });

  it("accepts a subject of any record type", async () => {
    const subjects = [
      uriOf("app.certified.actor.profile", "self"),
      uriOf("org.hypercerts.context.evaluation"),
      uriOf("org.hypercerts.context.attachment"),
      uriOf("org.hypercerts.collection"),
    ];
    const { context, creates } = fakeRepo({
      existing: Object.fromEntries(subjects.map((uri) => [uri, CID])),
    });

    await createAttachment(context, {
      title: "Comment",
      subjects: subjects.map((uri) => ({ uri })),
    });

    expect(writeOf(creates[0] ?? [], ATTACHMENT).value.subjects).toEqual(
      subjects.map((uri) => ({ uri, cid: CID })),
    );
  });

  it("keeps the order of the content and uploads each file", async () => {
    const { context, requests, creates } = fakeRepo();

    await createAttachment(context, {
      title: "Files",
      content: ["https://example.org/a", pdf(), "https://example.org/b"],
    });

    expect(methods(requests)).toEqual([UPLOAD, APPLY]);
    expect(
      (writeOf(creates[0] ?? [], ATTACHMENT).value.content as { $type: string }[]).map(
        (item) => item.$type,
      ),
    ).toEqual([
      "org.hypercerts.defs#uri",
      "org.hypercerts.defs#smallBlob",
      "org.hypercerts.defs#uri",
    ]);
  });

  it("reuses an existing location by URI without writing it", async () => {
    const existingLocation = uriOf(LOCATION);
    const { context, creates } = fakeRepo({ existing: { [existingLocation]: CID } });

    const result = await createAttachment(context, {
      title: "Photo",
      location: { uri: existingLocation },
    });

    expect(creates[0]).toHaveLength(1);
    expect(writeOf(creates[0] ?? [], ATTACHMENT).value.location).toEqual({
      uri: existingLocation,
      cid: CID,
    });
    expect(result.location).toEqual({ uri: existingLocation, cid: CID, created: false });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      "a subject that is a bare string",
      { subjects: [uriOf(ACTIVITY)] },
      /subjects\[0\] must be \{ uri \} of an existing record/,
    ],
    [
      "a work-scope tag where a vocabulary tag is held",
      { tags: [{ uri: uriOf(WORKSCOPE) }] },
      /tags\[0\] points at a record of type org\.hypercerts\.workscope\.tag, but this field holds org\.hypercerts\.vocab\.tag/,
    ],
    [
      "a content entry that is a number",
      { content: [5] },
      /must be a Blob or File.*\$\.content\[0\]/,
    ],
    ["a misspelled field", { subject: [] }, /Allowed fields: title, contentType, content/],
    ["a missing title", { title: undefined }, /invalid input: .*title/],
    [
      "a title the lexicon rejects",
      { title: "x".repeat(257) },
      /input is not a valid org\.hypercerts\.context\.attachment record/,
    ],
    [
      "a new location the lexicon rejects",
      { location: { ...location, locationType: "x".repeat(21) } },
      /location is not a valid app\.certified\.location record/,
    ],
    [
      "two new tags with the same key",
      { tags: [tag("a", "b"), tag("a", "b")] },
      /input\.tags\[0\] and input\.tags\[1\] are both new org\.hypercerts\.vocab\.tag records with the key a\.b/,
    ],
  ])("sends nothing for %s", async (_, fields, message) => {
    const { context, requests } = fakeRepo();
    const input = { title: "Attachment", ...fields };

    await expect(createAttachment(context, input as unknown as AttachmentInput)).rejects.toThrow(
      message,
    );

    expect(requests).toHaveLength(0);
  });

  it("reads subjects before uploading anything, and writes nothing when one cannot be resolved", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createAttachment(context, {
        title: "Report",
        subjects: [{ uri: uriOf(ACTIVITY) }],
        content: [pdf()],
      }),
    ).rejects.toThrow(/cannot resolve .*the record was not found/);

    expect(methods(requests)).toEqual([GET_RECORD]);
  });

  it("checks that a new tag's key is free before uploading, and writes nothing when it is taken", async () => {
    const taken = uriOf(VOCAB, "evidence-kind.survey");
    const { context, requests } = fakeRepo({ existing: { [taken]: CID } });

    const error = await createAttachment(context, {
      title: "Report",
      content: [pdf()],
      tags: [tag("evidence-kind", "survey")],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RecordAlreadyExistsError);
    expect(error.uri).toBe(taken);
    expect(methods(requests)).toEqual([GET_RECORD]);
  });

  it("does not upload a file the lexicon would reject", async () => {
    const { context, requests } = fakeRepo();
    const tooBig = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/pdf" });

    await expect(createAttachment(context, { title: "Big", content: [tooBig] })).rejects.toThrow(
      /content\[0\] cannot be stored as a blob.*Nothing was uploaded/,
    );

    expect(requests).toHaveLength(0);
  });

  it("does not write when an upload fails, and names the content entry", async () => {
    const { context, requests } = fakeRepo({ uploadBlob: () => json(500, { error: "Internal" }) });

    await expect(
      createAttachment(context, { title: "Report", content: ["https://example.org/a", pdf()] }),
    ).rejects.toThrow(/createAttachment: could not upload input\.content\[1\]/);

    expect(methods(requests)).toEqual([UPLOAD]);
  });
});

describe("createAttachment description", () => {
  const document: LeafletDocument = { $type: LEAFLET, blocks: [] };
  const documentUri = uriOf("pub.leaflet.document");

  it.each<[string, AttachmentInput["description"], object]>([
    ["a Leaflet document, as it is", document, document],
    [
      "{ uri } of a record of any type, as a strong reference",
      { uri: documentUri },
      { $type: "com.atproto.repo.strongRef", uri: documentUri, cid: CID },
    ],
  ])("stores %s", async (_, description, stored) => {
    const { context, creates } = fakeRepo({ existing: { [documentUri]: CID } });

    const result = await createAttachment(context, { title: "Report", description });

    expect(writeOf(creates[0] ?? [], ATTACHMENT).value.description).toEqual(stored);
    if (typeof description === "object" && "uri" in description) {
      expect(result.description).toEqual({ uri: documentUri, cid: CID, created: false });
    }
  });

  it("sends nothing for a Leaflet document without its $type", async () => {
    const { context, requests } = fakeRepo();

    await expect(
      createAttachment(context, {
        title: "Report",
        description: { blocks: [] },
      } as unknown as AttachmentInput),
    ).rejects.toThrow(/must be a string, \{ uri \}/);

    expect(methods(requests).includes(APPLY)).toBe(false);
  });
});
