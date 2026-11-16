import type { NsidString } from "@atproto/lex";
import type { StrongRef } from "../internal/resolve-record-ref.js";

/**
 * Thrown by `unfollowAccount`, `unfollowEntity`, `unlike` and `unrepost` when the account has more
 * than one record for the target. Nothing was deleted.
 *
 * @remarks
 * The account did the same thing more than once (it liked a record twice, for example). The SDK
 * cannot tell which record is meant, and deleting all of them is a decision for the caller. Delete
 * the extra records yourself, for example with `com.atproto.repo.deleteRecord` on all but one of
 * `matches` (or on all of them to remove the action entirely), then call again if needed.
 *
 * `matches` holds every matching record the scan saw, each with the CID it had.
 *
 * @example
 * ```ts
 * import { AmbiguousMatchError, unlike } from "@hypercerts-org/sdk/social";
 *
 * try {
 *   await unlike(context, { targetUri }); // `context` comes from createSDKContext
 * } catch (error) {
 *   if (error instanceof AmbiguousMatchError) {
 *     console.log(error.matches.map((match) => match.uri)); // the duplicate likes
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
export class AmbiguousMatchError extends Error {
  override readonly name = "AmbiguousMatchError";
  /** Every matching record, at least two. */
  readonly matches: readonly StrongRef[];

  constructor(operation: string, collection: NsidString, matches: readonly StrongRef[]) {
    super(
      `${operation}: the account has ${matches.length} ${collection} records for this target, so none was deleted because the SDK cannot tell which one is meant. Delete the extra records yourself (error.matches lists them), then call again.`,
    );
    this.matches = matches;
  }
}
