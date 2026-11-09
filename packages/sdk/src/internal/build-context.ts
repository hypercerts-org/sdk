import type { DidString, l, RecordKeyString } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError } from "./describe.js";
import { type PreparedRecord, prepareRecord } from "./prepare-record.js";

/**
 * What every step of one creation call shares: the client's repo, the timestamp used as the
 * default `createdAt` of every record the call creates, and the public function's name for
 * error messages.
 */
export interface BuildContext {
  readonly context: SDKContext;
  readonly did: DidString;
  readonly createdAt: string;
  readonly operation: string;
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
  return { context, did, createdAt: new Date().toISOString(), operation };
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
