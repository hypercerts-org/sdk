// The WriteTarget for an organization's repo, written through the Certified Group Service (CGS).
//
// CGS has no batch write today, only `app.certified.group.repo.{createRecord,putRecord,deleteRecord,
// uploadBlob}`, one record per request. `cgsTarget.submit` therefore sends a plan's writes one after
// the other, and is not atomic (`atomic: false`).
//
// This file is kept batch-shaped on purpose: `WritePlan` is the whole unit of work, and nothing
// outside this file knows that it is sent record by record. When CGS gains `applyWrites`, only this
// file changes: `submit` becomes one service-auth token (`lxm` = `...applyWrites`) and one request
// with `plan.creates`, `plan.updates` and `plan.swapCommit`, `atomic` becomes `true`, and
// PartialWriteError stops being thrown. The read-back after an unknown outcome for a create stays,
// because the PDS answers a create at a taken key with a 500 in `applyWrites` as well.
//
// Rules for every request:
// - Authentication comes from `cgs-auth.ts`, chosen once per target: a fresh service-auth token per
//   request from the signed-in account's PDS, or the group's API key. `repo` is on the querystring of
//   every request, which an API-key request needs to find its group.
// - `createRecord` is always sent with `rkey`, so the URIs that records hold to each other stay valid.
// - Updates use `putRecord` with the plan's `swapRecord`. CGS does not declare that field but passes
//   it to the PDS (checked in .reports/cgs-swap-test.md), which refuses a stale one with
//   `InvalidSwap`.
// - `swapCommit` is never sent: it is repo-wide, so any other member's write would refuse the plan,
//   and a plan that needs it (`createOrganization`) is guarded by its create-only keys instead.
// - Reads (`readHead`, `recordExists`) go to the organization's own PDS, never through CGS.
import { Client, type DidString, l } from "@atproto/lex";
import type { BlobData } from "../blob/upload-blob.js";
import type { CgsConfig, SDKContext } from "../context.js";
import {
  PartialWriteError,
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
import { type CgsRequestAuth, cgsRequestAuth, type RequestPurpose } from "./cgs-auth.js";
import { describeError } from "./describe.js";
import type { PreparedRecord } from "./prepare-record.js";
import {
  clientForRepo,
  type PdsClients,
  parseRecordUri,
  type StrongRef,
} from "./resolve-record-ref.js";
import { uploadVia } from "./upload-via.js";
import {
  classifyDeleteFailure,
  type DeleteTarget,
  readHead,
  recordExists,
  submitRequest,
  toAlreadyExists,
  type WritePlan,
  type WriteRequest,
  type WriteTarget,
} from "./write-target.js";

const CGS_SERVICE = "the Certified Group Service";

const repoDid = l.string({ format: "did" });
const collection = l.string({ format: "nsid" });
const rkey = l.string({ format: "record-key" });
const written = l.jsonPayload({
  uri: l.string({ format: "at-uri" }),
  cid: l.string({ format: "cid" }),
});

// The group lexicons, declared here because `Client` bundles only `com.atproto.*`. `swapRecord` is
// not in CGS's own lexicons: it passes through to the PDS (see the top comment). `repo` is a
// querystring parameter on all of them, besides the body.
const createRecord = l.procedure(
  "app.certified.group.repo.createRecord",
  l.params({ repo: repoDid }),
  l.jsonPayload({ repo: repoDid, collection, rkey, record: l.lexMap() }),
  written,
);
const putRecord = l.procedure(
  "app.certified.group.repo.putRecord",
  l.params({ repo: repoDid }),
  l.jsonPayload({
    repo: repoDid,
    collection,
    rkey,
    record: l.lexMap(),
    swapRecord: l.optional(l.nullable(l.string({ format: "cid" }))),
  }),
  written,
);
const deleteRecord = l.procedure(
  "app.certified.group.repo.deleteRecord",
  l.params({ repo: repoDid }),
  l.jsonPayload({
    repo: repoDid,
    collection,
    rkey,
    swapRecord: l.optional(l.string({ format: "cid" })),
  }),
  l.jsonPayload({}),
);
const uploadBlob = l.procedure(
  "app.certified.group.repo.uploadBlob",
  l.params({ repo: repoDid }),
  l.payload("*/*"),
  l.jsonPayload({ blob: l.blob() }),
);

type Credential = Awaited<ReturnType<CgsRequestAuth["forRequest"]>>;

/**
 * Whether calling again after a failure cannot duplicate records. Only when every create has a
 * fixed key: a create-only plan, or a `retrySafe` plan not marked `retrySafeOnlyAtomically`. That
 * mark means the plan is safe to repeat on the atomic PDS target only because the call reads before
 * writing (`createOrganization` with new locations, whose keys are generated). Here the records are
 * written one request at a time, so some may have landed before the failure and a repeat would
 * create them again under new keys.
 */
function retrySafeOnCgs(plan: WritePlan): boolean {
  return plan.createOnly || (plan.retrySafe === true && plan.retrySafeOnlyAtomically !== true);
}

type CgsMethod = typeof createRecord | typeof putRecord | typeof deleteRecord | typeof uploadBlob;

// The request options and answer of a CGS call, loosely typed: each method's own schema checks
// them when the request is made.
type CallOptions = { params?: object; body?: unknown; encoding?: string };
type CallBody = Record<string, unknown> & { blob?: unknown };

/** One request of a plan: a create, or an update of a record that exists. */
interface Step {
  readonly kind: "create" | "update";
  readonly record: PreparedRecord;
  readonly swapRecord: string | undefined;
  readonly noun: string | undefined;
}

/**
 * The target for the organization repo `repo`, written through the Certified Group Service at
 * `cgs`. `operation` names the public function in error messages.
 *
 * Boundaries:
 * - Not atomic. `submit` sends the creates, then the updates, in plan order, one request each, and
 *   stops at the first that fails. It throws that write's own error when nothing had landed yet,
 *   and PartialWriteError when at least one record had.
 * - Never sends `plan.swapCommit`: the guard is lost on this target, and callers must say so. A
 *   guarded single-record update keeps its `swapRecord`.
 * - A create that ends without a usable answer (CGS answers a taken key with HTTP 502, the same as
 *   a server fault) is read back from the organization's PDS: the same CID means it was written, a
 *   different CID is RecordAlreadyExistsError, and no record is WriteOutcomeUnknownError.
 * - A create-only plan (`plan.createOnly`) checks first, per create, that the key is free on the
 *   organization's PDS, and throws RecordAlreadyExistsError if not: CGS has no `swapRecord: null`,
 *   and without the check the read-back above could not tell a record that was already there from
 *   one this call wrote. Two racing calls can still both pass it.
 * - Advice to call again is given only when every create has a fixed key (see `retrySafeOnCgs`).
 * - `delete` sends `swapRecord` when `target.cid` is given. A member who deletes a record that is
 *   already gone gets HTTP 403 (CGS then checks admin rights), so on a 403 the record is read back
 *   and its absence counts as success.
 * - Never retries. Failure classification is shared with `pdsTarget`.
 * - A failure to get the credential (the service-auth token) throws a plain Error before anything is
 *   sent for that request.
 * - Under an API key, a 401 or 403 is reported as WriteRejectedError with a message that names the key
 *   by `cgsk_<ref>` only, never its secret.
 */
export function cgsTarget(
  context: SDKContext,
  cgs: CgsConfig,
  repo: DidString,
  operation: string,
): WriteTarget {
  const pdsClients: PdsClients = new Map();
  const orgPds = () => clientForRepo(context, repo, pdsClients);
  // Chosen once: a target never falls back from one credential to another.
  const auth = cgsRequestAuth(context, cgs, operation);

  const target: WriteTarget = {
    did: repo,
    atomic: false,
    readHead: async () => readHead(await orgPds(), repo, operation),
    recordExists: async (collection, rkey) => recordExists(await orgPds(), repo, collection, rkey),
    uploadBlob: async (body: BlobData, mimeType) => {
      let mime = "";
      try {
        return await uploadVia(
          async (data, encoding) => {
            mime = encoding;
            return (await call(uploadBlob, { body: data, encoding })).blob;
          },
          body,
          mimeType,
          CGS_SERVICE,
        );
      } catch (error) {
        throw error instanceof Error ? explainRefusal(error, { mime }) : error;
      }
    },
    submit: (plan) => submitSteps(plan),
    delete: (deleteTarget) => deleteOne(deleteTarget),
  };
  return target;

  // Authenticates one request with the target's credential and posts it to CGS.
  async function call(method: CgsMethod, options: CallOptions): Promise<CallBody> {
    return post(await auth.forRequest(method.nsid, repo), method, options);
  }

  async function post(
    { headers: credentials }: Credential,
    method: CgsMethod,
    options: CallOptions,
  ): Promise<CallBody> {
    const client = new Client({
      // Looked up when the request is made, so a replaced global `fetch` takes effect.
      fetchHandler: (path, init) => {
        const headers = new Headers(init.headers);
        for (const [name, value] of Object.entries(credentials)) headers.set(name, value);
        return globalThis.fetch(`${cgs.url}${path}`, { ...init, headers });
      },
    });
    // `repo` is also on the querystring of every request: an API-key request finds its group there.
    const withRepo = { ...options, params: { ...options.params, repo } };
    return (await client.xrpc(method as never, withRepo as never)).body as CallBody;
  }

  // Words a 401 or 403 the way the credential's kind needs; any other failure is returned as it is.
  function explainRefusal(error: Error, purpose: RequestPurpose): Error {
    const cause = error.cause as
      | { status?: unknown; message?: unknown; error?: unknown }
      | undefined;
    const status = cause?.status;
    if (status !== 401 && status !== 403) return error;
    const message = auth.explainRefusal(operation, {
      status,
      cgsMessage: String(cause?.message),
      repo,
      purpose,
    });
    if (message === undefined) return error;
    const attempted = error instanceof WriteRejectedError ? error.attempted : [];
    const code = typeof cause?.error === "string" ? cause.error : undefined;
    return new WriteRejectedError(message, attempted, { status, code }, { cause: error.cause });
  }

  async function submitSteps(plan: WritePlan): Promise<void> {
    const steps: Step[] = [
      ...plan.creates.map((record) => ({
        kind: "create" as const,
        record,
        swapRecord: undefined,
        noun: undefined,
      })),
      ...plan.updates.map(({ record, swapRecord, noun }) => ({
        kind: "update" as const,
        record,
        swapRecord,
        noun,
      })),
    ];
    const landed: StrongRef[] = [];
    for (const [i, step] of steps.entries()) {
      const failure = await attempt(step, plan);
      if (failure === undefined) {
        landed.push(step.record.ref);
        continue;
      }
      if (landed.length === 0) throw failure;
      throw partialWrite(plan, landed, steps, i, failure);
    }
  }

  // Sends one step. Resolves to undefined when the record landed, else to the error to report.
  async function attempt(step: Step, plan: WritePlan): Promise<Error | undefined> {
    const { record } = step;
    const request: WriteRequest = {
      created: step.kind === "create" ? [record.ref] : [],
      updated: step.kind === "update" ? [record.ref] : [],
      swapCommit: undefined,
      service: CGS_SERVICE,
      staleRecord:
        step.swapRecord === undefined
          ? undefined
          : { uri: record.ref.uri, noun: step.noun ?? "record" },
    };
    // A create-only plan skips the caller's check that its key is free (it relies on the PDS's
    // `swapRecord: null`, which CGS cannot apply), so check here. Without it, a record that
    // already exists identical to ours would be mistaken after an unknown outcome for our own write.
    if (step.kind === "create" && plan.createOnly) {
      const taken = await checkKeyFree(record);
      if (taken !== undefined) return taken;
    }
    // Outside the classified request: no credential means nothing was sent for this step.
    const method = step.kind === "create" ? createRecord : putRecord;
    let credential: Credential;
    try {
      credential = await auth.forRequest(method.nsid, repo);
    } catch (error) {
      return error as Error;
    }
    try {
      await submitRequest(
        operation,
        request,
        async () => [await send(credential, method, step)],
        retrySafeOnCgs(plan),
      );
      return undefined;
    } catch (error) {
      if (step.kind === "create" && error instanceof WriteOutcomeUnknownError) {
        return readBackCreate(record, error);
      }
      return explainRefusal(error as Error, {
        action: step.kind,
        collection: record.collection,
      });
    }
  }

  // Resolves to the error to report when the key is taken or cannot be checked, else undefined.
  async function checkKeyFree({
    collection,
    rkey,
    ref,
  }: PreparedRecord): Promise<Error | undefined> {
    let found: StrongRef | undefined;
    try {
      found = await target.recordExists(collection, rkey);
    } catch (error) {
      return new Error(
        `${operation}: cannot check whether ${ref.uri} already exists (${describeError(error)}), so nothing was sent for it to ${CGS_SERVICE}.`,
        { cause: error },
      );
    }
    if (found === undefined) return undefined;
    return toAlreadyExists(operation, ref.uri, {
      attempted: [ref],
      status: 400,
      code: "RecordAlreadyExists",
    });
  }

  function send(credential: Credential, method: CgsMethod, { record, swapRecord }: Step) {
    const body = { repo, collection: record.collection, rkey: record.rkey, record: record.value };
    return post(credential, method, {
      body: { ...body, ...(swapRecord === undefined ? {} : { swapRecord }) },
    });
  }

  // CGS answers a create at a taken key with 502, like a server fault, so the record decides.
  async function readBackCreate(
    { collection, rkey, ref }: PreparedRecord,
    unknown: WriteOutcomeUnknownError,
  ): Promise<Error | undefined> {
    let found: StrongRef | undefined;
    try {
      found = await target.recordExists(collection, rkey);
    } catch {
      return unknown;
    }
    if (found === undefined) return unknown;
    if (found.cid === ref.cid) return undefined;
    return toAlreadyExists(operation, ref.uri, {
      attempted: [ref],
      status: 400,
      code: "InvalidSwap",
      cause: unknown,
    });
  }

  async function deleteOne({ uri, cid }: DeleteTarget): Promise<void> {
    const parsed = parseRecordUri(uri, operation);
    const credential = await auth.forRequest(deleteRecord.nsid, repo);
    try {
      await post(credential, deleteRecord, {
        body: {
          repo,
          collection: parsed.collection,
          rkey: parsed.rkey,
          ...(cid === undefined ? {} : { swapRecord: cid }),
        },
      });
    } catch (error) {
      const failure = classifyDeleteFailure(operation, error, parsed.atUri, cid, CGS_SERVICE);
      if (failure instanceof WriteRejectedError && failure.status === 403) {
        if (await isGone(parsed.collection, parsed.rkey)) return;
      }
      throw explainRefusal(failure, { action: "delete", collection: parsed.collection });
    }
  }

  async function isGone(collection: PreparedRecord["collection"], rkey: PreparedRecord["rkey"]) {
    try {
      return (await target.recordExists(collection, rkey)) === undefined;
    } catch {
      return false;
    }
  }

  function partialWrite(
    plan: WritePlan,
    landed: readonly StrongRef[],
    steps: readonly Step[],
    index: number,
    failure: Error,
  ): PartialWriteError {
    const failed = steps[index]?.record.ref as StrongRef;
    const notAttempted = steps.slice(index + 1).map((step) => step.record.ref);
    // The failed step's own message advises for a single request ("nothing was written", "call
    // again"), which is wrong after a partial write, so only its reason is used.
    const retry = retrySafeOnCgs(plan);
    return new PartialWriteError(
      `${operation}: ${landed.length} of ${steps.length} records were written to ${repo} before ${failed.uri} failed, and ${notAttempted.length} were not sent. ` +
        `Written: ${landed.map((ref) => ref.uri).join(", ")}. Cause: ${failureReason(failure)}. ` +
        "The written records are in the repository and stay there; the SDK does not roll back or retry. " +
        (retry
          ? `Calling ${operation} again is safe: every record has a fixed key and is only created if absent, so the call creates what is missing or fails because a record exists. `
          : "Do not call again with the same input, which would create them a second time: keep them, or call again and pass the written records as { uri } where the input accepts existing records. ") +
        "`error.failure` has the full error.",
      { written: landed, failed, failure, notAttempted },
    );
  }

  // Why one step failed, without the advice its own message gives for a single-request write.
  function failureReason(failure: Error): string {
    if (failure instanceof RecordAlreadyExistsError) {
      return `a record already exists at ${failure.uri}`;
    }
    const raw = describeError(failure.cause ?? failure);
    if (failure instanceof WriteRejectedError) return `rejected by ${CGS_SERVICE}: ${raw}`;
    if (failure instanceof WriteOutcomeUnknownError)
      return `no usable answer from ${CGS_SERVICE}: ${raw}`;
    if (failure instanceof WriteResultMismatchError) {
      return `${CGS_SERVICE} reported different URIs or CIDs than the SDK computed`;
    }
    // The service-auth failure: its message holds the reason and the scope hint.
    return failure.message.replace(`${operation}: `, "");
  }
}
