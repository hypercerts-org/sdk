import type { CidString, DidString } from "@atproto/lex";
import { l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import { describeError } from "./describe.js";

// `com.atproto.sync.getLatestCommit` is not among the lexicons bundled with `Client`.
const getLatestCommit = l.query(
  "com.atproto.sync.getLatestCommit",
  l.params({ did: l.string({ format: "did" }) }),
  l.jsonPayload({ cid: l.string({ format: "cid" }), rev: l.string() }),
  ["RepoNotFound", "RepoTakendown", "RepoSuspended", "RepoDeactivated"],
);

/**
 * Reads the CID of the head commit of `did`'s repo from the client's PDS, to pass as `swapCommit`
 * to a write that must not land on top of changes it has not seen.
 *
 * Internal. Read the head BEFORE reading the records the write is based on: a write that happens
 * in between then moves the head past the CID returned here, and the PDS rejects the request.
 * Reading in the other order would let that write go unnoticed.
 *
 * Throws Error, naming `operation`, when the PDS cannot be reached, does not know the repo or
 * answers with something unreadable.
 */
export async function readRepoHead(
  context: SDKContext,
  did: DidString,
  operation: string,
): Promise<CidString> {
  try {
    // `service: null` and `labelers: null`: the head must come from the account's own PDS, not from
    // an AppView the client may proxy to by default (the typed record methods do the same).
    const { body } = await context.client.xrpc(getLatestCommit, {
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
