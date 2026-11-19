import type { DidString, LexMap } from "@atproto/lex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivity, createRights } from "./activity/index.js";
import { createProfile } from "./actor/index.js";
import { awardBadge, respondToBadgeAward } from "./badge/index.js";
import { addActivityToCollection, createCollection } from "./collection/index.js";
import { PartialWriteError, RecordAlreadyExistsError } from "./errors.js";
import { createOrganization, OrganizationAlreadyExistsError } from "./organization/index.js";
import { like, unlike } from "./social/index.js";
import { fakeCgs, ORG } from "./test-utils/fake-cgs.js";
import { DID, json } from "./test-utils/fake-pds.js";
import { fakeRepo } from "./test-utils/fake-repo.js";
import { png } from "./test-utils/records.js";

const repo = ORG as DidString;
const CREATE = "app.certified.group.repo.createRecord";
const PUT = "app.certified.group.repo.putRecord";
const COLLECTION = "org.hypercerts.collection";
const ACTIVITY = "org.hypercerts.claim.activity";
const RIGHTS = "org.hypercerts.claim.rights";
const PROFILE = "app.certified.actor.profile";
const ORGANIZATION = "app.certified.actor.organization";

afterEach(() => {
  vi.unstubAllGlobals();
});

const rightsInput = {
  rightsName: "CC BY 4.0",
  rightsType: "CC-BY",
  rightsDescription: "Free to share and adapt with attribution.",
};

describe("writes with { repo: orgDid }", () => {
  it("createRights sends one createRecord for the org, with a URI in the org's repo", async () => {
    const cgs = fakeCgs();

    const result = await createRights(cgs.context, rightsInput, { repo });

    expect(cgs.requests.map((request) => request.method)).toEqual([CREATE]);
    const [request] = cgs.requests;
    expect(request?.body).toMatchObject({ repo: ORG, collection: RIGHTS });
    expect(result.uri).toBe(`at://${ORG}/${RIGHTS}/${request?.body?.rkey}`);
    expect(cgs.store.get(result.uri)?.cid).toBe(result.cid);
  });

  it("creates supporting records before the Activity, and every reference points into the org", async () => {
    const cgs = fakeCgs();

    const result = await createActivity(
      cgs.context,
      {
        title: "Trees",
        shortDescription: "Planting trees",
        rights: rightsInput,
        image: png(),
      },
      { repo },
    );

    const writes = cgs.of("createRecord");
    expect(writes.map((request) => request.body?.collection)).toEqual([RIGHTS, ACTIVITY]);
    expect(cgs.of("uploadBlob")).toHaveLength(1);
    expect(cgs.of("uploadBlob")[0]?.params).toEqual({ repo: ORG });
    const activity = writes[1]?.body?.record as { rights: { uri: string; cid: string } };
    expect(activity.rights.uri).toBe(`at://${ORG}/${RIGHTS}/${writes[0]?.body?.rkey}`);
    expect(activity.rights.cid).toBe(cgs.store.get(activity.rights.uri)?.cid);
    expect(result.uri.startsWith(`at://${ORG}/${ACTIVITY}/`)).toBe(true);
  });

  it("reports PartialWriteError with the supporting record that landed when the Activity fails", async () => {
    const cgs = fakeCgs({
      answer: (request) =>
        request.body?.collection === ACTIVITY
          ? json(400, { error: "InvalidRequest", message: "no" })
          : undefined,
    });

    const error = await createActivity(
      cgs.context,
      { title: "Trees", shortDescription: "Planting trees", rights: rightsInput },
      { repo },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PartialWriteError);
    expect(error.written).toHaveLength(1);
    expect(error.written[0].uri).toContain(`/${RIGHTS}/`);
    expect(error.failed.uri).toContain(`/${ACTIVITY}/`);
    expect(error.notAttempted).toEqual([]);
  });

  it("adds a new Activity to an org Collection: createRecord, then putRecord guarded by the Collection's CID, never swapCommit", async () => {
    const uri = `at://${ORG}/${COLLECTION}/3k2a4b5c6d7e8`;
    const stored: LexMap = {
      $type: COLLECTION,
      title: "Portfolio",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const cgs = fakeCgs({ records: { [uri]: stored } });

    const result = await addActivityToCollection(
      cgs.context,
      { collection: { uri }, activity: { title: "Trees", shortDescription: "Planting trees" } },
      { repo },
    );

    expect(cgs.requests.map((request) => request.method)).toEqual([CREATE, PUT]);
    const put = cgs.requests[1]?.body as { swapRecord: string; record: { items: unknown[] } };
    expect(put.swapRecord).toBeDefined();
    expect(put.record.items).toHaveLength(1);
    expect(cgs.requests.every((request) => request.body?.swapCommit === undefined)).toBe(true);
    expect(result.uri).toBe(uri);
  });

  it("refuses a Collection in another repo than the org", async () => {
    const cgs = fakeCgs();

    const error = await addActivityToCollection(
      cgs.context,
      {
        collection: { uri: `at://${DID}/${COLLECTION}/3k2a4b5c6d7e8` },
        activity: { title: "Trees", shortDescription: "Planting trees" },
      },
      { repo },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("repository of");
    expect(error.message).toContain(`the organization repo ${ORG} (written via { repo })`);
    expect(error.message).not.toContain(`(${DID})`);
    expect(cgs.requests).toEqual([]);
  });

  it("createCollection with an existing org Activity writes the Collection with one createRecord", async () => {
    const activityUri = `at://${ORG}/${ACTIVITY}/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [activityUri]: {
          $type: ACTIVITY,
          title: "Trees",
          shortDescription: "x",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    await createCollection(
      cgs.context,
      { title: "Portfolio", items: [{ uri: activityUri, weight: "2" }] },
      { repo },
    );

    expect(cgs.requests.map((request) => request.method)).toEqual([CREATE]);
  });

  it("createOrganization writes the profile then the organization at `self`, without swapCommit", async () => {
    const cgs = fakeCgs();

    const result = await createOrganization(
      cgs.context,
      { organization: { legalName: "Acme" }, profileIfMissing: { displayName: "Acme" } },
      { repo },
    );

    expect(cgs.of("createRecord").map((request) => request.body?.collection)).toEqual([
      PROFILE,
      ORGANIZATION,
    ]);
    expect(cgs.requests.every((request) => request.body?.rkey === "self")).toBe(true);
    expect(cgs.requests.every((request) => request.body?.swapCommit === undefined)).toBe(true);
    expect(result.uri).toBe(`at://${ORG}/${ORGANIZATION}/self`);
    // The head is still read, from the org's PDS, for a later applyWrites.
    expect(cgs.calls).toContain("org com.atproto.sync.getLatestCommit");
  });

  it("createOrganization stops before writing when the org already has an organization", async () => {
    const cgs = fakeCgs({
      records: { [`at://${ORG}/${ORGANIZATION}/self`]: { $type: ORGANIZATION } },
    });

    const error = await createOrganization(
      cgs.context,
      { organization: {}, profileIfMissing: { displayName: "Acme" } },
      { repo },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(OrganizationAlreadyExistsError);
    expect(cgs.requests).toEqual([]);
  });

  describe("createOrganization when another writer creates the organization after it was read", () => {
    const organizationUri = `at://${ORG}/${ORGANIZATION}/self`;
    // Plants another writer's organization the moment the SDK sends its own.
    const racing = (records?: Record<string, LexMap>) => {
      const cgs: ReturnType<typeof fakeCgs> = fakeCgs({
        records: records ?? {},
        answer: (request) => {
          if (request.body?.collection === ORGANIZATION) {
            cgs.store.set(organizationUri, {
              cid: "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
              value: { $type: ORGANIZATION, legalName: "Someone else" },
            });
          }
          return undefined;
        },
      });
      return cgs;
    };

    it("reports OrganizationAlreadyExistsError when the profile was reused", async () => {
      const cgs = racing({
        [`at://${ORG}/${PROFILE}/self`]: { $type: PROFILE, displayName: "Old" },
      });

      const error = await createOrganization(
        cgs.context,
        { organization: { legalName: "Acme" } },
        { repo },
      ).catch((e) => e);

      expect(error).toBeInstanceOf(OrganizationAlreadyExistsError);
      expect(error.uri).toBe(organizationUri);
      expect(cgs.of("createRecord").map((request) => request.body?.collection)).toEqual([
        ORGANIZATION,
      ]);
    });

    it("reports PartialWriteError with the profile that landed and RecordAlreadyExistsError as the failure", async () => {
      const cgs = racing();

      const error = await createOrganization(
        cgs.context,
        { organization: { legalName: "Acme" }, profileIfMissing: { displayName: "Acme" } },
        { repo },
      ).catch((e) => e);

      expect(error).toBeInstanceOf(PartialWriteError);
      expect(error.written.map((ref: { uri: string }) => ref.uri)).toEqual([
        `at://${ORG}/${PROFILE}/self`,
      ]);
      expect(error.failure).toBeInstanceOf(RecordAlreadyExistsError);
      expect(error.failure.uri).toBe(organizationUri);
    });
  });

  it("createProfile of the org: a taken `self` key is reported through the read-back", async () => {
    const cgs = fakeCgs({
      records: { [`at://${ORG}/${PROFILE}/self`]: { $type: PROFILE, displayName: "Old" } },
    });

    const error = await createProfile(cgs.context, { displayName: "New" }, { repo }).catch(
      (e) => e,
    );

    expect(error.name).toBe("ProfileAlreadyExistsError");
  });

  it("like and unlike act on the org's repo: unlike deletes with swapRecord", async () => {
    const subject = `at://${ORG}/${ACTIVITY}/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [subject]: {
          $type: ACTIVITY,
          title: "T",
          shortDescription: "s",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const liked = await like(cgs.context, { subject: { uri: subject } }, { repo });
    await unlike(cgs.context, { like: liked }, { repo });

    expect(liked.uri.startsWith(`at://${ORG}/app.certified.feed.like/`)).toBe(true);
    expect(cgs.of("deleteRecord")[0]?.body).toMatchObject({ repo: ORG, swapRecord: liked.cid });
    expect(cgs.store.has(liked.uri)).toBe(false);
  });

  it("unlike refuses a record of the account's own repo when writing to the org", async () => {
    const cgs = fakeCgs();

    const error = await unlike(
      cgs.context,
      { like: { uri: `at://${DID}/app.certified.feed.like/3k2a4b5c6d7e8` } },
      { repo },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(`the organization repo ${ORG} (written via { repo })`);
    expect(cgs.requests).toEqual([]);
  });

  it("awardBadge checks allowedIssuers against the org, not the member, and names the org", async () => {
    const definition = `at://${ORG}/app.certified.badge.definition/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [definition]: {
          $type: "app.certified.badge.definition",
          title: "T",
          badgeType: "verification",
          allowedIssuers: [{ did: DID }],
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const error = await awardBadge(
      cgs.context,
      { definition: { uri: definition }, subject: { did: "did:plc:other222" } },
      { repo },
    ).catch((e) => e);

    expect(error.message).toContain(`the award would be written to the organization repo ${ORG}`);
    expect(error.message).toContain(`lets only ${DID} award it`);
    expect(cgs.requests).toEqual([]);
  });

  it("awardBadge writes the award to the org when the org is an allowed issuer", async () => {
    const definition = `at://${ORG}/app.certified.badge.definition/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [definition]: {
          $type: "app.certified.badge.definition",
          title: "T",
          badgeType: "verification",
          allowedIssuers: [{ did: ORG }],
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const result = await awardBadge(
      cgs.context,
      { definition: { uri: definition }, subject: { did: "did:plc:other222" } },
      { repo },
    );

    expect(result.uri.startsWith(`at://${ORG}/app.certified.badge.award/`)).toBe(true);
    expect(cgs.requests.map((request) => request.method)).toEqual([CREATE]);
  });

  it("respondToBadgeAward requires the org to be the recipient and names the org", async () => {
    const award = `at://${ORG}/app.certified.badge.award/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [award]: {
          $type: "app.certified.badge.award",
          badge: {
            uri: `at://${ORG}/app.certified.badge.definition/3k2a4b5c6d7e8`,
            cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          },
          subject: { $type: "app.certified.defs#did", did: DID },
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const error = await respondToBadgeAward(
      cgs.context,
      { award: { uri: award }, response: "accepted" },
      { repo },
    ).catch((e) => e);

    expect(error.message).toContain(`is for ${DID}`);
    expect(error.message).toContain(
      `the response would be written to the organization repo ${ORG}`,
    );
    expect(cgs.requests).toEqual([]);
  });

  it("respondToBadgeAward writes the response to the org when the award is for the org", async () => {
    const award = `at://${ORG}/app.certified.badge.award/3k2a4b5c6d7e8`;
    const cgs = fakeCgs({
      records: {
        [award]: {
          $type: "app.certified.badge.award",
          badge: {
            uri: `at://${ORG}/app.certified.badge.definition/3k2a4b5c6d7e8`,
            cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          },
          subject: { $type: "app.certified.defs#did", did: ORG },
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    const result = await respondToBadgeAward(
      cgs.context,
      { award: { uri: award }, response: "accepted" },
      { repo },
    );

    expect(result.uri.startsWith(`at://${ORG}/app.certified.badge.response/`)).toBe(true);
  });

  it("a handle as repo throws a TypeError before any request", async () => {
    const cgs = fakeCgs();

    const error = await createRights(cgs.context, rightsInput, {
      repo: "acme.test" as DidString,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("Handles are not accepted");
    expect(cgs.requests).toEqual([]);
  });

  it("an own-DID repo is the account's own PDS: no CGS request, no token", async () => {
    const { context, requests } = fakeRepo();

    await createRights(context, rightsInput, { repo: DID as DidString });

    expect(requests.map((request) => request.path)).toEqual([
      expect.stringContaining("com.atproto.repo.applyWrites"),
    ]);
  });

  it("an org repo without cgs on the context throws a TypeError before any request", async () => {
    const { context, requests } = fakeRepo();

    const error = await createRights(context, rightsInput, { repo }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("cgs");
    expect(requests).toEqual([]);
  });
});
