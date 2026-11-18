import {
  type DidString,
  isDidString,
  type l,
  type RecordKeyString,
  type TypedBlobRef,
} from "@atproto/lex";
import type { SDKContext } from "../context.js";
import type { WriteOptions } from "../write-options.js";
import { cgsTarget } from "./cgs-target.js";
import { describeError, describeValue } from "./describe.js";
import { type PreparedRecord, prepareRecord } from "./prepare-record.js";
import { assertRecordUriOfType, parseRecordUri } from "./resolve-record-ref.js";
import { pdsTarget, type WriteTarget } from "./write-target.js";

/**
 * What every step of one creation call shares: the client's repo, the timestamp used as the
 * default `createdAt` of every record the call creates, where the call writes (`target`), the
 * public function's name for error messages, and the call's uploads.
 */
export interface BuildContext {
  readonly context: SDKContext;
  readonly did: DidString;
  /** Where this call writes, reads for writing and uploads blobs. `target.did` is `did`. */
  readonly target: WriteTarget;
  readonly createdAt: string;
  readonly operation: string;
  /** The uploads of this call by `Blob` object, so a file used twice is uploaded once. */
  readonly uploads: Map<Blob, Promise<TypedBlobRef>>;
}

/**
 * Starts a creation call. Fails before any request is sent when the client is not authenticated,
 * or when `options.repo` names an organization and the context has no `cgs`, so a missing session
 * or setup is not discovered after blobs were uploaded.
 *
 * `options.repo` absent or the client's own DID: the target is the account's own repo. Any other
 * DID: the target is that repo through the Certified Group Service.
 *
 * Throws Error when the client has no DID, TypeError when `options.repo` is not a DID or names
 * another repo and the context has no `cgs`.
 */
export function createBuildContext(
  context: SDKContext,
  operation: string,
  options?: WriteOptions,
): BuildContext {
  const did = context.client.did;
  if (did === undefined) {
    throw new Error(
      `${operation}: the client is not authenticated, so there is no repository to write to. Sign in first, then create the context with \`createSDKContext({ client: new Client(session) })\`.`,
    );
  }
  const target = selectTarget(context, operation, did, options);
  return {
    context,
    did: target.did,
    target,
    createdAt: new Date().toISOString(),
    operation,
    uploads: new Map(),
  };
}

function selectTarget(
  context: SDKContext,
  operation: string,
  own: DidString,
  options: WriteOptions | undefined,
): WriteTarget {
  const repo: unknown = options?.repo;
  if (repo === undefined || repo === own) return pdsTarget(context, own, operation);
  if (typeof repo !== "string" || !isDidString(repo)) {
    throw new TypeError(
      `${operation}: \`repo\` must be the DID of a repository, for example "did:plc:abc123", but received ${describeValue(repo)}. Handles are not accepted. Nothing was sent.`,
    );
  }
  if (context.cgs === undefined) {
    throw new TypeError(
      `${operation}: \`repo\` is ${repo}, which is not the signed-in account (${own}), so the write goes through the Certified Group Service, but the context has no \`cgs\`. Create it with \`createSDKContext({ client, cgs: { url, did } })\`. Nothing was sent.`,
    );
  }
  return cgsTarget(context, context.cgs, repo, operation);
}

/**
 * Checks caller data against an input schema. `field` names the data in the message, for example
 * `input` or `locations[1]`.
 *
 * Throws TypeError with the schema's message, which includes the path of the offending property.
 */
export function parseInput<T>(
  build: BuildContext,
  field: string,
  schema: l.Schema<T>,
  value: unknown,
): T {
  const result = schema.safeValidate(value);
  if (result.success) return result.value as T;
  throw new TypeError(`${build.operation}: invalid ${field}: ${describeError(result)}.`, {
    cause: result,
  });
}

/**
 * Splits `uri` into its parts (see `parseRecordUri`) and checks that it names a record of
 * `collection` in the signed-in account's own repo, before any request is sent.
 *
 * For operations that change a record the caller names by URI. The caller words the two
 * refusals, because what to do about each depends on the operation.
 *
 * Throws TypeError: what `parseRecordUri` throws, or the message `reject` gives for a record of
 * another collection (`reject.collection`, given that collection) or of another account
 * (`reject.repository`, given its DID).
 */
export function parseOwnRecordUri(
  build: BuildContext,
  uri: string,
  collection: string,
  reject: {
    collection: (actual: string) => string;
    repository: (did: string) => string;
  },
) {
  const parsed = parseRecordUri(uri, build.operation);
  assertRecordUriOfType(build.operation, "uri", uri, [collection], reject.collection);
  if (parsed.did !== build.did) throw new TypeError(reject.repository(parsed.did));
  return parsed;
}

/**
 * Validates a record against its lexicon and prepares it for writing (see `prepareRecord`), at
 * `rkey` when the input chose the key.
 *
 * Throws TypeError, naming `field`, when the record is not valid for its lexicon.
 */
export async function prepareChecked<S extends l.RecordSchema>(
  build: BuildContext,
  field: string,
  schema: S,
  record: Omit<l.InferInput<S>, "$type">,
  rkey?: RecordKeyString,
): Promise<PreparedRecord> {
  try {
    return await prepareRecord(build.did, schema, record, rkey);
  } catch (error) {
    throw new TypeError(
      `${build.operation}: ${field} is not a valid ${schema.$type} record: ${describeError(error)}.`,
      { cause: error },
    );
  }
}
