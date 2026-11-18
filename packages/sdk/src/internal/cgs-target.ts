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
// - A fresh service-auth token per request (they are single-use and bound to one method), from the
//   signed-in account's PDS. Service auth only: no API keys.
// - `createRecord` is always sent with `rkey`, so the URIs that records hold to each other stay valid.
// - Updates use `putRecord` with the plan's `swapRecord`. CGS does not declare that field but passes
//   it to the PDS (checked in .reports/cgs-swap-test.md), which refuses a stale one with
//   `InvalidSwap`.
// - `swapCommit` is never sent: it is repo-wide, so any other member's write would refuse the plan,
//   and a plan that needs it (`createOrganization`) is guarded by its create-only keys instead.
// - Reads (`readHead`, `recordExists`) go to the organization's own PDS, never through CGS.
import { Client, type DidString, l, type NsidString } from "@atproto/lex";
import type { BlobData } from "../blob/upload-blob.js";
import type { CgsConfig, SDKContext } from "../context.js";
import { PartialWriteError, WriteOutcomeUnknownError, WriteRejectedError } from "../errors.js";
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

/**
 * The service id of CGS's DID document entry. The scope `aud` of an `rpc:` permission must be a
 * DID with a fragment, and the PDS matches a requested token's `aud` against the scope as given.
 */
const SERVICE_ID = "certified_group_service";

/** The scope an OAuth session needs for one CGS method (`#` is written `%23` in a scope string). */
const scopeFor = (cgsDid: string, lxm: string) => `rpc:${lxm}?aud=${cgsDid}%23${SERVICE_ID}`;

const repoDid = l.string({ format: "did" });
const collection = l.string({ format: "nsid" });
const rkey = l.string({ format: "record-key" });
const written = l.jsonPayload({
  uri: l.string({ format: "at-uri" }),
  cid: l.string({ format: "cid" }),
});

// The group lexicons, declared here because `Client` bundles only `com.atproto.*`. `swapRecord` is
// not in CGS's own lexicons: it passes through to the PDS (see the top comment).
const createRecord = l.procedure(
  "app.certified.group.repo.createRecord",
  l.params(),
  l.jsonPayload({ repo: repoDid, collection, rkey, record: l.lexMap() }),
  written,
);
const putRecord = l.procedure(
  "app.certified.group.repo.putRecord",
  l.params(),
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
  l.params(),
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

// `com.atproto.server.getServiceAuth` is not among the lexicons bundled with `Client`. `aud` is a
// plain string here, not format "did": the PDS accepts a `did:web:host#service` reference (and a
// scope can only name that form), which the `did` format would refuse before the request is sent.
const getServiceAuth = l.query(
  "com.atproto.server.getServiceAuth",
  l.params({ aud: l.string(), lxm: l.string({ format: "nsid" }) }),
  l.jsonPayload({ token: l.string() }),
);

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
 * - `delete` sends `swapRecord` when `target.cid` is given. A member who deletes a record that is
 *   already gone gets HTTP 403 (CGS then checks admin rights), so on a 403 the record is read back
 *   and its absence counts as success.
 * - Never retries. Failure classification is shared with `pdsTarget`.
 * - A failure to get the service-auth token throws a plain Error before anything is sent for that
 *   request.
 */
export function cgsTarget(
  context: SDKContext,
  cgs: CgsConfig,
  repo: DidString,
  operation: string,
): WriteTarget {
  const pdsClients: PdsClients = new Map();
  const orgPds = () => clientForRepo(context, repo, pdsClients);

  const target: WriteTarget = {
    did: repo,
    atomic: false,
    readHead: async () => readHead(await orgPds(), repo, operation),
    recordExists: async (collection, rkey) => recordExists(await orgPds(), repo, collection, rkey),
    uploadBlob: (body: BlobData, mimeType) =>
      uploadVia(
        async (data, encoding) =>
          (await call(uploadBlob, { params: { repo }, body: data, encoding })).blob,
        body,
        mimeType,
        CGS_SERVICE,
      ),
    submit: (plan) => submitSteps(plan),
    delete: (deleteTarget) => deleteOne(deleteTarget),
  };
  return target;

  // Asks the account's PDS for a token for `method` and posts one request to CGS with it.
  async function call(method: CgsMethod, options: CallOptions): Promise<CallBody> {
    return post(await serviceAuth(method.nsid), method, options);
  }

  async function post(token: string, method: CgsMethod, options: CallOptions): Promise<CallBody> {
    const client = new Client({
      // Looked up when the request is made, so a replaced global `fetch` takes effect.
      fetchHandler: (path, init) => {
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${token}`);
        return globalThis.fetch(`${cgs.url}${path}`, { ...init, headers });
      },
    });
    return (await client.xrpc(method as never, options as never)).body as CallBody;
  }

  async function serviceAuth(lxm: NsidString): Promise<string> {
    try {
      const { body } = await context.client.xrpc(getServiceAuth, {
        params: { aud: `${cgs.did}#${SERVICE_ID}`, lxm },
        service: null,
        labelers: null,
      });
      return body.token;
    } catch (error) {
      throw new Error(
        `${operation}: cannot get a service-auth token for ${lxm} from the account's PDS (${describeError(error)}), so nothing was sent to the Certified Group Service. With OAuth, the session needs the scope ${scopeFor(cgs.did, lxm)} (one such scope per CGS method: createRecord, putRecord, deleteRecord and uploadBlob).`,
        { cause: error },
      );
    }
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
      throw partialWrite(landed, steps, i, failure);
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
    // Outside the classified request: no token means nothing was sent for this step.
    const method = step.kind === "create" ? createRecord : putRecord;
    let token: string;
    try {
      token = await serviceAuth(method.nsid);
    } catch (error) {
      return error as Error;
    }
    try {
      await submitRequest(
        operation,
        request,
        async () => [await send(token, method, step)],
        // Create-only writes use a fixed key and createRecord never overwrites, so repeating is
        // safe, the same as pdsTarget's create-only path.
        plan.retrySafe ?? plan.createOnly,
        plan.retrySafeReason,
      );
      return undefined;
    } catch (error) {
      if (step.kind === "create" && error instanceof WriteOutcomeUnknownError) {
        return readBackCreate(record, error);
      }
      return error as Error;
    }
  }

  function send(token: string, method: CgsMethod, { record, swapRecord }: Step) {
    const body = { repo, collection: record.collection, rkey: record.rkey, record: record.value };
    return post(token, method, {
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
    const token = await serviceAuth(deleteRecord.nsid);
    try {
      await post(token, deleteRecord, {
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
      throw failure;
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
    landed: readonly StrongRef[],
    steps: readonly Step[],
    index: number,
    failure: Error,
  ): PartialWriteError {
    const failed = steps[index]?.record.ref as StrongRef;
    const notAttempted = steps.slice(index + 1).map((step) => step.record.ref);
    return new PartialWriteError(
      `${operation}: ${landed.length} of ${steps.length} records were written to ${repo} before ${failed.uri} failed, and ${notAttempted.length} were not sent. ` +
        `Written: ${landed.map((ref) => ref.uri).join(", ")}. Cause: ${describeError(failure.cause ?? failure)}. ` +
        "The written records are in the repository and stay there; the SDK does not roll back or retry. Do not call again with the same input, which would create them a second time: " +
        "keep them, or call again and pass the written records as { uri } where the input accepts existing records. `error.failure` has the full error.",
      { written: landed, failed, failure, notAttempted },
    );
  }
}
