import type { DidString } from "@atproto/lex";

/**
 * The optional last argument of every operation that writes: which repository to write to.
 *
 * @remarks
 * Leave `repo` out, or pass the signed-in account's own DID, and the operation writes to the
 * account's own repository through the context's client, exactly as without this argument.
 *
 * Pass the DID of an organization's repository to write to it through the Certified Group Service
 * (CGS) instead. The context must then have been created with `cgs` (see
 * {@link createSDKContext}), and the signed-in account must be a member of the group with the role
 * the operation needs; CGS enforces that, and the SDK does not check it. The operation sends one
 * request per record, so it cannot be atomic: see {@link PartialWriteError}.
 *
 * @example
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * // `context` was created with `cgs`; `orgDid` is the organization's DID.
 * await createProject(context, input, { repo: orgDid });
 * ```
 */
export interface WriteOptions {
  /**
   * The DID of the repository to write to. Default: the signed-in account's own repository.
   *
   * @remarks
   * Not a handle: a handle can change hands, and the SDK stores URIs and CIDs that must keep
   * pointing at this repository.
   */
  readonly repo?: DidString | undefined;
}
