import type { l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  parseInput,
  prepareChecked,
} from "../internal/build-context.js";
import type { StandaloneCreator } from "../internal/create-record.js";
import { compact } from "../internal/input.js";
import { resolveRecordRef } from "../internal/resolve-record-ref.js";
import { submitDelete, submitWrites } from "../internal/submit-writes.js";
import type { ActionOptions, SocialAction, UndoFunction } from "./action.js";
import { listCollection } from "./list-collection.js";

/**
 * The function that creates one social record (a follow, an entity follow, a like or a repost) in
 * the client's repo: validates the input, reads the records it must point at, builds the record and
 * writes it.
 *
 * Internal. Boundaries:
 * - Writes with a new TID key each call, and looks for nothing that exists already, so calling it
 *   again for the same target creates another record.
 * - Reads `via` (and, for a like or a repost, the target) from the PDS that hosts it, and writes
 *   nothing if a read fails.
 * - Does not touch the target or `via`.
 *
 * The function throws TypeError for invalid input, and what the reads and `submitWrites` throw.
 */
export function createAction<TCreate extends TUndo & ActionOptions, TUndo extends object>(
  action: SocialAction<TCreate, TUndo>,
): StandaloneCreator<TCreate> {
  return async (context, input) => {
    const { build, parsed } = start(context, action.names.create, action.createInput, input);
    const [subject, via] = await Promise.all([
      action.subject(context, parsed),
      parsed.via === undefined ? undefined : resolveRecordRef(context, parsed.via),
    ]);
    const record = await prepareChecked(
      build,
      "input",
      action.schema,
      compact({ subject, createdAt: parsed.createdAt ?? build.createdAt, via }) as never,
    );
    // No retry: a second request would create a second record under a new key.
    await submitWrites(context, build.did, [record], build.operation);
    return record.ref;
  };
}

/**
 * The function that removes the one social record in the client's repo that is for the input's
 * target.
 *
 * Internal. Boundaries:
 * - Looks only at the action's collection in the client's own repository, and reads all of it
 *   (see `listCollection`). It does not read the target, so a target that was edited or deleted
 *   does not prevent the removal. No indexer is consulted.
 * - Deletes only when exactly one record matches, and then only if that record still has the CID
 *   the scan saw (see `submitDelete`). With several matches it deletes nothing.
 * - The scan is a snapshot; it cannot stop another writer creating a matching record.
 *
 * The function throws TypeError for invalid input, Error when the collection cannot be read in
 * full, and what `submitDelete` throws.
 */
export function undoAction<TCreate extends TUndo & ActionOptions, TUndo extends object>(
  action: SocialAction<TCreate, TUndo>,
): UndoFunction<TUndo> {
  return async (context, input) => {
    const { build, parsed } = start(context, action.names.undo, action.targetInput, input);
    const records = await listCollection(context, build.did, action.schema.$type, build.operation);
    const matches = records.filter(({ value }) => action.isSubject(value.subject, parsed));
    const [match, ...others] = matches;
    if (match === undefined) return { status: "not-found" };
    if (others.length > 0) return { status: "ambiguous", matchCount: matches.length };
    await submitDelete(context, build.did, match.ref, build.operation);
    return { status: "deleted" };
  };
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
