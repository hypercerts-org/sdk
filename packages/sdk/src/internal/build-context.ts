import type { DidString, l, RecordKeyString, TypedBlobRef } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError } from "./describe.js";
import { type PreparedRecord, prepareRecord } from "./prepare-record.js";
import { parseRecordUri } from "./resolve-record-ref.js";

/**
 * What every step of one creation call shares: the client's repo, the timestamp used as the
 * default `createdAt` of every record the call creates, the public function's name for
 * error messages, and the call's uploads.
 */
export interface BuildContext {
  readonly context: SDKContext;
  readonly did: DidString;
  readonly createdAt: string;
  readonly operation: string;
  /** The uploads of this call by `Blob` object, so a file used twice is uploaded once. */
  readonly uploads: Map<Blob, Promise<TypedBlobRef>>;
}

/**
 * Starts a creation call. Fails before any request is sent when the client is not authenticated,
 * so a missing session is not discovered after blobs were uploaded.
 *
 * Throws Error when the client has no DID.
 */
export function createBuildContext(context: SDKContext, operation: string): BuildContext {
  const did = context.client.did;
  if (did === undefined) {
    throw new Error(
      `${operation}: the client is not authenticated, so there is no repository to write to. Sign in first, then create the context with \`createSDKContext({ client: new Client(session) })\`.`,
    );
  }
  return { context, did, createdAt: new Date().toISOString(), operation, uploads: new Map() };
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
 * Internal. For operations that change a record the caller names by URI. The caller words the two
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
  if (parsed.collection !== collection) throw new TypeError(reject.collection(parsed.collection));
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
