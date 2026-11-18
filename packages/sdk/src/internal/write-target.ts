import type {
  CidString,
  DidString,
  NsidString,
  RecordKeyString,
  TypedBlobRef,
  TypedLexMap,
} from "@atproto/lex";
import { type Client, l } from "@atproto/lex";
import type { BlobData } from "../blob/upload-blob.js";
import type { SDKContext } from "../context.js";
import {
  RecordAlreadyExistsError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
import { describeError, isRecordNotFound } from "./describe.js";
import type { PreparedRecord } from "./prepare-record.js";
import { parseRecordUri, type StrongRef } from "./resolve-record-ref.js";
import { uploadVia } from "./upload-via.js";

/** An existing record to replace with a new full value. */
export interface PlannedUpdate {
  /** The new full value, prepared with the record key the record already has. */
  readonly record: PreparedRecord;
  /**
   * The CID the record had when the caller read it and built `record` from it. Replace only if the
   * record still has it. A target that cannot check one record alone (the PDS's `applyWrites` cannot)
   * must apply it through `WritePlan.swapCommit` or say so in its documentation.
   */
  readonly swapRecord?: CidString | undefined;
  /** What the record is called in the message when `swapRecord` no longer matches, for example "Collection". Default: "record". */
  readonly noun?: string | undefined;
}

/** What one call writes to a repo, in the order it must be written. */
export interface WritePlan {
  /** New records, in dependency order: records that others reference come first. */
  readonly creates: readonly PreparedRecord[];
  /** Existing records to replace with a new full value, written after the creates. */
  readonly updates: readonly PlannedUpdate[];
  /** Every create must fail if its record key is already taken. */
  readonly createOnly: boolean;
  /**
   * The CID of the repo's head commit as the caller read it (see {@link WriteTarget.readHead}). Set
   * it for a plan with several writes, where a per-record `swapRecord` cannot cover them all. A
   * target that cannot enforce it must say so in its documentation.
   */
  readonly swapCommit?: CidString | undefined;
  /**
   * Whether calling again after an unknown outcome cannot duplicate records. A target must use it
   * (with `retrySafeReason`) to word the advice in its outcome-unknown error; it changes nothing
   * else. See `SubmitOptions.retrySafe` in submit-writes.ts.
   */
  readonly retrySafe?: boolean | undefined;
  /**
   * Why calling again is safe, when it is not "every record has a fixed key". Used by a target
   * in its outcome-unknown message, with `retrySafe`.
   */
  readonly retrySafeReason?: string | undefined;
}

/** The record `WriteTarget.delete` removes, and the version it must still have, if known. */
export interface DeleteTarget {
  /** The record's URI, `at://<did>/<collection>/<rkey>`. */
  readonly uri: string;
  /** Delete only if the record still has this CID. Absent: delete whatever version it has. */
  readonly cid?: CidString | undefined;
}

/**
 * Where one call writes: a repo, and the way to reach it. Every write, read-for-write and blob
 * upload of a call goes through it, so a call can target a repo other than the client's own.
 */
export interface WriteTarget {
  /** The repo written to. Becomes `build.did`, so URIs and CIDs are computed for that repo. */
  readonly did: DidString;
  /** Whether `submit` applies a plan as one commit, all or nothing. */
  readonly atomic: boolean;
  /** The CID of the repo's head commit, read from the repo's own PDS. */
  readHead(): Promise<CidString>;
  /** The record at `collection`/`rkey` (URI and CID), or undefined when there is none. */
  recordExists(collection: NsidString, rkey: RecordKeyString): Promise<StrongRef | undefined>;
  /** Uploads a blob to the repo. `mimeType` undefined: derive it from `body`. */
  uploadBlob(body: BlobData, mimeType?: string): Promise<TypedBlobRef>;
  /**
   * Writes the plan. Throws WriteRejectedError, WriteOutcomeUnknownError,
   * WriteResultMismatchError or RecordAlreadyExistsError.
   */
  submit(plan: WritePlan): Promise<void>;
  /** Deletes one record. Throws WriteRejectedError or WriteOutcomeUnknownError. */
  delete(target: DeleteTarget): Promise<void>;
}

// `com.atproto.sync.getLatestCommit` is not among the lexicons bundled with `Client`.
export const getLatestCommit = l.query(
  "com.atproto.sync.getLatestCommit",
  l.params({ did: l.string({ format: "did" }) }),
  l.jsonPayload({ cid: l.string({ format: "cid" }), rev: l.string() }),
  ["RepoNotFound", "RepoTakendown", "RepoSuspended", "RepoDeactivated"],
);

/**
 * The target for the signed-in account's own repo, written through the context's client with
 * `applyWrites` (one atomic commit), `putRecord` for create-only writes, and `deleteRecord`.
 * `operation` names the public function in error messages.
 *
 * Boundaries, for every write:
 * - Never retries and never splits a request; the caller decides what to do about a failure.
 *   `plan.retrySafe` only changes the advice in the error message.
 * - Does not pass `validate`, so the PDS applies its own default; records are validated by the
 *   builders against their lexicons before they get here.
 * - Classifies a failure as definite only when the PDS answered with an HTTP 4xx other than 408.
 *   Everything else, including a 2xx whose body the client could not read, is outcome-unknown.
 * - Compares the PDS's reported URIs and CIDs with the computed ones, because records already
 *   reference each other by CID (not possible for deletes: `deleteRecord` answers with a commit).
 *
 * `submit` with `createOnly: false` uses `applyWrites`, one atomic commit. `plan.swapCommit` is the
 * only guard against a concurrent change that `applyWrites` offers. It covers the whole repo, so
 * any other write to the account since the head was read, not only one to the updated record,
 * rejects the request: a false alarm the caller accepts. Throws WriteRejectedError,
 * WriteOutcomeUnknownError or WriteResultMismatchError.
 *
 * `submit` with one update, no creates and an `updates[0].swapRecord` uses `putRecord` with that
 * `swapRecord`, so only a change to that record itself, not any other write to the account,
 * rejects the request (WriteRejectedError, `code` `InvalidSwap`, "the <noun> changed since it was
 * read"). It never reads the head. A plan with more writes keeps `applyWrites` and `swapCommit`.
 * Calling again after an unknown outcome is not safe in general: the caller built the new value
 * from what it read, and a first attempt that succeeded changed the record.
 *
 * `submit` with `createOnly: true` uses `putRecord` with `swapRecord: null`, the lexicon's own "only
 * if absent". `applyWrites` cannot tell the caller a key is taken: the reference PDS answers a
 * `create` at a taken key with a generic HTTP 500, indistinguishable from a server fault.
 * `putRecord` is checked together with the write, so concurrent calls cannot overwrite each other,
 * and answers a taken key with HTTP 400 `InvalidSwap`, which is reported as a
 * RecordAlreadyExistsError (the only reason this request can fail that way). Checked against the
 * reference PDS only. Calling again after an unknown outcome is safe: the key is the same and the
 * write is only made if absent. The plan must hold exactly one create and no updates, else
 * TypeError.
 *
 * `delete` uses `deleteRecord`, with `swapRecord: target.cid` when given. With a CID it never
 * deletes a record that has another version: the PDS refuses (WriteRejectedError with `code`
 * `InvalidSwap`) and nothing is deleted. Without one the delete is unconditional. The reference PDS
 * treats an already-missing record as nothing to do and answers success whatever `swapRecord` says,
 * so calling again after any outcome is safe. `attempted` of the errors is `[{ uri, cid }]` with a
 * CID and empty without one. Throws TypeError when `target.uri` is not a record URI.
 */
export function pdsTarget(context: SDKContext, did: DidString, operation: string): WriteTarget {
  return {
    did,
    atomic: true,
    readHead: () => readHead(context.client, did, operation),
    recordExists: (collection, rkey) => recordExists(context.client, did, collection, rkey),
    uploadBlob: (body, mimeType) =>
      uploadVia(
        async (data, encoding) => (await context.client.uploadBlob(data, { encoding })).body.blob,
        body,
        mimeType,
      ),
    submit: (plan) => {
      if (plan.createOnly) return submitCreateOnly(context, did, operation, plan);
      return isGuardedSingleUpdate(plan)
        ? submitGuardedUpdate(context, did, operation, plan)
        : submitApplyWrites(context, did, operation, plan);
    },
    delete: (target) => deleteRecord(context, did, operation, target),
  };
}

// One update to a record the caller read, and nothing else: the one plan `putRecord` can carry
// with a check on that record alone.
function isGuardedSingleUpdate(plan: WritePlan): boolean {
  return (
    plan.creates.length === 0 &&
    plan.updates.length === 1 &&
    plan.updates[0]?.swapRecord !== undefined
  );
}

/**
 * The head commit of `did`'s repo as `client` reports it. `client` must talk to the account's own
 * PDS: that is the client's own PDS for the signed-in account, and a client for the PDS in the DID
 * document for any other.
 */
export async function readHead(client: Client, did: DidString, operation: string) {
  try {
    // `service: null` and `labelers: null`: the head must come from the account's own PDS, not from
    // an AppView the client may proxy to by default (the typed record methods do the same).
    const { body } = await client.xrpc(getLatestCommit, {
      params: { did },
      service: null,
      labelers: null,
    });
    return body.cid;
  } catch (error) {
    throw new Error(
      `${operation}: cannot read the latest commit of ${did}'s repository, so the write cannot be made safe against concurrent changes (${describeError(error)}). Nothing was written.`,
      { cause: error },
    );
  }
}

/** The record at `collection`/`rkey` in `did`'s repo, read through `client` (see {@link readHead}). */
export async function recordExists(
  client: Client,
  did: DidString,
  collection: NsidString,
  rkey: RecordKeyString,
): Promise<StrongRef | undefined> {
  try {
    const { body } = await client.getRecord(collection, rkey, { repo: did });
    // The lexicon types `cid` as optional; a PDS always sends it, and callers only test for presence.
    return { uri: body.uri, cid: body.cid } as StrongRef;
  } catch (error) {
    if (isRecordNotFound(error)) return undefined;
    throw error;
  }
}

async function submitApplyWrites(
  context: SDKContext,
  did: DidString,
  operation: string,
  plan: WritePlan,
): Promise<void> {
  const { creates } = plan;
  const updates = plan.updates.map(({ record }) => record);
  const request: WriteRequest = {
    created: creates.map((record) => record.ref),
    updated: updates.map((record) => record.ref),
    swapCommit: plan.swapCommit,
  };
  return submitRequest(
    operation,
    request,
    async () => {
      const response = await context.client.applyWrites(
        () => [
          ...creates.map(({ collection, rkey, value }) => ({
            $type: "com.atproto.repo.applyWrites#create" as const,
            collection,
            rkey,
            value,
          })),
          ...updates.map(({ collection, rkey, value }) => ({
            $type: "com.atproto.repo.applyWrites#update" as const,
            collection,
            rkey,
            value,
          })),
        ],
        {
          repo: did,
          ...(plan.swapCommit === undefined ? {} : { swapCommit: plan.swapCommit }),
        },
      );
      return response.body.results;
    },
    plan.retrySafe ?? false,
    plan.retrySafeReason,
  );
}

async function submitGuardedUpdate(
  context: SDKContext,
  did: DidString,
  operation: string,
  plan: WritePlan,
): Promise<void> {
  const [{ record, swapRecord, noun }] = plan.updates as [PlannedUpdate, ...PlannedUpdate[]];
  await submitRequest(
    operation,
    {
      created: [],
      updated: [record.ref],
      swapCommit: undefined,
      staleRecord: { uri: record.ref.uri, noun: noun ?? "record" },
    },
    async () => {
      const response = await context.client.putRecord(
        record.value as TypedLexMap<NsidString>,
        record.rkey,
        { repo: did, ...(swapRecord === undefined ? {} : { swapRecord }) },
      );
      return [response.body];
    },
    plan.retrySafe ?? false,
    plan.retrySafeReason,
  );
}

async function submitCreateOnly(
  context: SDKContext,
  did: DidString,
  operation: string,
  plan: WritePlan,
): Promise<void> {
  const [record, ...rest] = plan.creates;
  if (record === undefined || rest.length > 0 || plan.updates.length > 0) {
    throw new TypeError(
      `${operation}: a create-only write holds exactly one create and no updates on the PDS (it uses putRecord), but got ${plan.creates.length} creates and ${plan.updates.length} updates. This is a bug in the SDK.`,
    );
  }
  if (plan.swapCommit !== undefined) {
    throw new TypeError(
      `${operation}: a create-only write cannot use swapCommit because it is sent with putRecord, which has no commit check, so the check would be silently dropped. Nothing was written. This is a bug in the SDK.`,
    );
  }
  try {
    await submitRequest(
      operation,
      { created: [record.ref], updated: [], swapCommit: undefined, staleRecord: undefined },
      async () => {
        const response = await context.client.putRecord(
          record.value as TypedLexMap<NsidString>,
          record.rkey,
          {
            repo: did,
            // The lexicon allows `null` ("must not exist yet"); the client's option type leaves it out.
            swapRecord: null as unknown as string,
          },
        );
        return [response.body];
      },
      true,
    );
  } catch (error) {
    throw error instanceof WriteRejectedError && error.code === "InvalidSwap"
      ? toAlreadyExists(operation, record.ref.uri, error)
      : error;
  }
}

async function deleteRecord(
  context: SDKContext,
  did: DidString,
  operation: string,
  target: DeleteTarget,
): Promise<void> {
  const { atUri, collection, rkey } = parseRecordUri(target.uri, operation);
  try {
    await context.client.deleteRecord(collection, rkey, {
      repo: did,
      ...(target.cid === undefined ? {} : { swapRecord: target.cid }),
    });
  } catch (error) {
    throw classifyDeleteFailure(operation, error, atUri, target.cid);
  }
}

/** What one request tried to write, for messages and for the errors' `attempted`. */
export interface WriteRequest {
  readonly created: readonly StrongRef[];
  readonly updated: readonly StrongRef[];
  readonly swapCommit: CidString | undefined;
  /** Set when the request is conditional on one record's CID (`putRecord` with `swapRecord`). */
  readonly staleRecord?: { readonly uri: string; readonly noun: string } | undefined;
  /** Who answers the request, as it reads in a message. Defaults to {@link PDS_SERVICE}. */
  readonly service?: string | undefined;
}

/** How errors name the account's PDS; the CGS target names the Certified Group Service instead. */
export const PDS_SERVICE = "the PDS";

const serviceOf = (request: WriteRequest) => request.service ?? PDS_SERVICE;

export function toAlreadyExists(
  operation: string,
  uri: string,
  rejected: Pick<WriteRejectedError, "attempted" | "status" | "code" | "cause">,
): RecordAlreadyExistsError {
  return new RecordAlreadyExistsError(
    `${operation}: a record already exists at ${uri}, so nothing was written and the existing record is unchanged. ${operation} only creates records; it never overwrites one.`,
    uri,
    rejected.attempted,
    { status: rejected.status, code: rejected.code },
    { cause: rejected.cause },
  );
}

export function classifyDeleteFailure(
  operation: string,
  error: unknown,
  uri: StrongRef["uri"],
  cid: CidString | undefined,
  service: string = PDS_SERVICE,
) {
  const reason = describeError(error);
  const attempted = cid === undefined ? [] : [{ uri, cid }];
  const rejection = definiteRejection(error);
  if (rejection === undefined) {
    return new WriteOutcomeUnknownError(
      `${operation}: no usable answer from ${service} (${reason}), so it is not known whether ${uri} was deleted. ` +
        `The SDK does not retry, but calling ${operation} again is safe: deleting a record that is already gone succeeds. To check first, use com.atproto.repo.getRecord.`,
      attempted,
      { cause: error },
    );
  }
  const { status, code } = rejection;
  const message =
    code === "InvalidSwap" && cid !== undefined
      ? `${operation}: ${uri} no longer has the version (CID ${cid}) that was given, so ${service} refused to delete it (HTTP ${status}: ${reason}). It was not deleted: something changed or replaced it in between. The SDK neither retries nor deletes without that check. Read the record for its current CID, or call ${operation} without \`cid\` to delete it whatever its version.`
      : `${operation}: ${service} rejected the request (HTTP ${status}: ${reason}), so ${uri} was not deleted. Fix the cause (for example the session's permissions or a rate limit) and call again.`;
  return new WriteRejectedError(message, attempted, rejection, { cause: error });
}

// The one rule for telling a refused request from an unknown outcome: the PDS answered with an
// HTTP 4xx other than 408 (so nothing was applied). Returns its status and XRPC error code, or
// undefined for everything else, including a 2xx whose body the client could not read.
function definiteRejection(
  error: unknown,
): { status: number; code: string | undefined } | undefined {
  const status = property(error, "status");
  // Positive range check, so a NaN status stays an unknown outcome.
  if (!(typeof status === "number" && status >= 400 && status < 500 && status !== 408)) {
    return undefined;
  }
  const code = property(error, "error");
  return { status, code: typeof code === "string" ? code : undefined };
}

// Sends one write request and checks what it reports. `send` resolves to the PDS's results, one
// per record in request order, or `undefined` if the PDS reported none. `retrySafe` says whether
// calling again after an unknown outcome cannot duplicate records; it only changes the advice in
// the error message.
export async function submitRequest(
  operation: string,
  request: WriteRequest,
  send: () => Promise<readonly unknown[] | undefined>,
  retrySafe: boolean,
  retrySafeReason?: string,
): Promise<void> {
  let results: readonly unknown[] | undefined;
  try {
    results = await send();
  } catch (error) {
    throw classifyFailure(operation, error, request, retrySafe, retrySafeReason);
  }
  assertReportedRefs(operation, request, results);
}

const attemptedOf = ({ created, updated }: WriteRequest) => [...created, ...updated];

const recordsOf = (refs: readonly StrongRef[]) =>
  refs.length === 1 ? "the record" : `the ${refs.length} records`;

// What a request did or did not do to each record, worded for `effect`. A request that only creates
// keeps the plain wording, so a caller never reads "created" about an update.
function describeEffects(
  { created, updated }: WriteRequest,
  effect: { created: string; changed: string },
): string {
  if (updated.length === 0) {
    return `${recordsOf(created)} ${created.length === 1 ? "was" : "were"} ${effect.created}`;
  }
  return [
    ...(created.length === 0 ? [] : [`${newRecordsOf(created)} ${effect.created}`]),
    `${updated.map((ref) => ref.uri).join(", ")} was ${effect.changed}`,
  ].join(" and ");
}

const newRecordsOf = (refs: readonly StrongRef[]) =>
  refs.length === 1 ? "the new record was" : `the ${refs.length} new records were`;

// The wording when the PDS refused the request, and when no usable answer came back.
const NOT_WRITTEN = { created: "not created", changed: "not changed" };
const MAYBE_WRITTEN = { created: "created", changed: "changed" };

function classifyFailure(
  operation: string,
  error: unknown,
  request: WriteRequest,
  retrySafe: boolean,
  retrySafeReason?: string,
) {
  const reason = describeError(error);
  const attempted = attemptedOf(request);
  const details = definiteRejection(error);
  if (details !== undefined) {
    const { status, code } = details;
    const message = rejectionMessage(operation, reason, status, code, request);
    return new WriteRejectedError(message, attempted, details, { cause: error });
  }
  return new WriteOutcomeUnknownError(
    `${operation}: no usable answer from ${serviceOf(request)} (${reason}), so it is not known whether ${describeEffects(request, MAYBE_WRITTEN)}: ${attempted.map((ref) => ref.uri).join(", ")}. ` +
      retryAdvice(operation, request, retrySafe, retrySafeReason),
    attempted,
    { cause: error },
  );
}

function rejectionMessage(
  operation: string,
  reason: string,
  status: number,
  code: string | undefined,
  request: Request,
): string {
  if (code === "InvalidSwap" && request.staleRecord !== undefined) {
    return recordChanged(operation, reason, request.staleRecord, serviceOf(request));
  }
  if (code === "InvalidSwap" && request.swapCommit !== undefined) {
    return repositoryChanged(operation, reason, request);
  }
  return (
    `${operation}: ${serviceOf(request)} rejected the request (HTTP ${status}: ${reason}), so ${describeEffects(request, NOT_WRITTEN)}. ` +
    "Nothing needs cleaning up. Fix the cause (for example the input, the session's permissions or a rate limit) and call again."
  );
}

function retryAdvice(
  operation: string,
  request: WriteRequest,
  retrySafe: boolean,
  retrySafeReason?: string,
): string {
  if (retrySafe) {
    const subject =
      retrySafeReason ??
      (attemptedOf(request).length !== 1
        ? "every record has a fixed key and none is created if it exists, so the call either creates them or fails because one already exists"
        : "the record has a fixed key and is only created if absent, so the call either creates it or fails because it already exists");
    return `The SDK does not retry, but calling ${operation} again is safe: ${subject}, most likely from the first attempt. To check first, use com.atproto.repo.getRecord.`;
  }
  if (request.created.length === 0) {
    return `Read ${request.updated.length === 1 ? "the updated record" : "the updated records"} (for example with com.atproto.repo.getRecord) to see whether the change was applied before trying again. The SDK does not retry, because calling ${operation} again would apply the change a second time if the first attempt succeeded.`;
  }
  const check =
    request.updated.length === 0
      ? "Check whether they exist"
      : "Check which of the new records exist and whether the updated record changed";
  return `${check} (for example with com.atproto.repo.getRecord) before trying again. The SDK does not retry, because calling ${operation} again would create duplicates with new record keys if the first attempt succeeded.`;
}

// `InvalidSwap` on `putRecord` with `swapRecord`: the record no longer has the CID the caller read.
function recordChanged(
  operation: string,
  reason: string,
  { uri, noun }: { uri: string; noun: string },
  service: string,
): string {
  return (
    `${operation}: the ${noun} changed since it was read (HTTP 400: ${reason}), so ${service} refused to replace ${uri}. ` +
    `Nothing was written: ${uri} was not changed. Other writes to the account do not cause this. The SDK neither retries nor merges. Nothing needs cleaning up. Call again to read the ${noun} afresh and try once more.`
  );
}

// `InvalidSwap` is what the PDS answers when the repo head is no longer the one the caller read:
// the one rejection that is not a mistake in the input and that calling again is expected to fix.
function repositoryChanged(operation: string, reason: string, request: WriteRequest): string {
  return (
    `${operation}: the repository changed since it was read (HTTP 400: ${reason}), most likely because another write to this account landed in between. ` +
    `Nothing was written: ${describeEffects(request, NOT_WRITTEN)}. The SDK neither retries nor merges. Nothing needs cleaning up. Call again to read the repository afresh and try once more.`
  );
}

// Duck-typed rather than `instanceof XrpcResponseError`: see `assertClient` in context.ts. Only
// that class has a numeric `status`; an unreadable 2xx response (XrpcInvalidResponseError) does not.
function property(error: unknown, name: "status" | "error"): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

// `results` is optional in the response schema. A PDS that omits it is trusted; one that returns
// it must agree with the computed references.
function assertReportedRefs(
  operation: string,
  request: WriteRequest,
  results: readonly unknown[] | undefined,
): void {
  if (results === undefined) return;
  const attempted = attemptedOf(request);
  const reported = results.map(toRef);
  const matches =
    reported.length === attempted.length &&
    reported.every((ref, i) => ref?.uri === attempted[i]?.uri && ref?.cid === attempted[i]?.cid);
  if (matches) return;
  const [applied, references] =
    request.updated.length === 0
      ? ["created the records", "the new records"]
      : ["applied the writes", "the records"];
  throw new WriteResultMismatchError(
    `${operation}: ${serviceOf(request)} ${applied} but reported different URIs or CIDs than the SDK computed, so references between ${references} may not match what is stored. ` +
      `Computed: ${JSON.stringify(attempted)}. Reported: ${JSON.stringify(reported)}.`,
    attempted,
    reported.filter((ref) => ref !== undefined),
  );
}

function toRef(result: unknown): StrongRef | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const { uri, cid } = result as { uri?: unknown; cid?: unknown };
  return typeof uri === "string" && typeof cid === "string"
    ? ({ uri, cid } as StrongRef)
    : undefined;
}
