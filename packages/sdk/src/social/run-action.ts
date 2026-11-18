import type { l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  parseInput,
  parseOwnRecordUri,
  prepareChecked,
} from "../internal/build-context.js";
import type { StandaloneCreator } from "../internal/create-record.js";
import { compact } from "../internal/input.js";
import { resolveRecordRef } from "../internal/resolve-record-ref.js";
import { submitDelete, submitWrites } from "../internal/submit-writes.js";
import {
  type ActionOptions,
  type SocialAction,
  type UndoField,
  type UndoFunction,
  type UndoInput,
  undoInputSchema,
} from "./action.js";

/**
 * The function that creates one social record (a follow, an entity follow, a like or a repost) in
 * the client's repo: validates the input, reads the records it must point at, builds the record and
 * writes it.
 *
 * Internal. Boundaries:
 * - Writes with a new TID key each call, and looks for nothing that exists already, so calling it
 *   again for the same subject creates another record.
 * - Reads `via` (and, for a like or a repost, the subject) from the PDS that hosts it, and writes
 *   nothing if a read fails.
 * - Does not touch the subject or `via`.
 *
 * The function throws TypeError for invalid input, and what the reads and `submitWrites` throw.
 */
export function createAction<TCreate extends ActionOptions, TField extends UndoField>(
  action: SocialAction<TCreate, TField>,
): StandaloneCreator<TCreate> {
  return async (context, input) => {
    const { build, parsed } = start(context, action.names.create, action.createInput, input);
    const [subject, via] = await Promise.all([
      action.subject(context, parsed),
      parsed.via === undefined
        ? undefined
        : resolveRecordRef(context, parsed.via.uri, action.names.create),
    ]);
    const record = await prepareChecked(
      build,
      "input",
      action.schema,
      compact({ subject, createdAt: parsed.createdAt ?? build.createdAt, via }) as never,
    );
    // No retry: a second request would create a second record under a new key.
    await submitWrites(build, [record]);
    return record.ref;
  };
}

/**
 * The function that deletes the one social record whose URI the input gives, from the client's repo.
 *
 * Internal. Boundaries:
 * - Deletes exactly that record, with one `submitDelete` request, and looks at nothing else: no scan
 *   of the collection, no read of the record or of what it points at, no indexer. Another record
 *   for the same subject, for example a duplicate like, is not touched.
 * - Refuses, before anything is sent, a URI that is not in the action's collection or not in the
 *   signed-in account's repository, so a wrong URI (the subject's, for example) cannot delete
 *   anything. The PDS would refuse another account's record anyway; this says why.
 * - With `cid` the delete is guarded by it (see `submitDelete`); without it, it is not.
 *
 * The function throws TypeError for invalid input, Error when the client is not authenticated, and
 * what `submitDelete` throws.
 */
export function undoAction<TCreate extends ActionOptions, TField extends UndoField>(
  action: SocialAction<TCreate, TField>,
): UndoFunction<UndoInput<TField>> {
  const schema = undoInputSchema(action.undoField);
  return async (context, input) => {
    const { build, parsed } = start(context, action.names.undo, schema, input);
    const { uri, cid } = parsed[action.undoField];
    assertOwnRecord(build, uri, action.schema.$type);
    await submitDelete(build, { uri, cid });
  };
}

// The input's URI must name a record the SDK may delete here: of this action's collection, in the
// signed-in account's repository.
function assertOwnRecord(build: BuildContext, uri: string, collection: string) {
  parseOwnRecordUri(build, uri, collection, {
    collection: (actual) =>
      `${build.operation}: ${uri} is a ${actual} record, not a ${collection} record. Pass the URI of the ${collection} record the account created (for example the \`uri\` its create function returned), not the URI of its subject. Nothing was sent.`,
    repository: (did) =>
      `${build.operation}: ${uri} is in the repository of ${did}, not of the signed-in account (${build.did}). Only the account's own records can be deleted. Nothing was sent.`,
  });
}

// Checks that the client is signed in, then the input, before anything is sent.
function start<T>(
  context: SDKContext,
  operation: string,
  schema: l.Schema<T>,
  input: unknown,
): { build: BuildContext; parsed: T } {
  const build = createBuildContext(context, operation);
  return { build, parsed: parseInput(build, "input", schema, input) };
}
