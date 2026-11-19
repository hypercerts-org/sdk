// How one request to the Certified Group Service (CGS) is authenticated. `cgsTarget` picks one
// `CgsRequestAuth` when it is built and never switches, so a key context never asks a PDS for a
// token and a session context never sends a key.
import { type Client, type DidString, l, type NsidString } from "@atproto/lex";
import type { CgsConfig, SDKContext } from "../context.js";
import { describeError } from "./describe.js";

/**
 * The service id of CGS's DID document entry. The scope `aud` of an `rpc:` permission must be a
 * DID with a fragment, and the PDS matches a requested token's `aud` against the scope as given.
 */
const SERVICE_ID = "certified_group_service";

/** The scope an OAuth session needs for one CGS method (`#` is written `%23` in a scope string). */
const scopeFor = (cgsDid: string, lxm: string) => `rpc:${lxm}?aud=${cgsDid}%23${SERVICE_ID}`;

// `com.atproto.server.getServiceAuth` is not among the lexicons bundled with `Client`. `aud` is a
// plain string here, not format "did": the PDS accepts a `did:web:host#service` reference (and a
// scope can only name that form), which the `did` format would refuse before the request is sent.
const getServiceAuth = l.query(
  "com.atproto.server.getServiceAuth",
  l.params({ aud: l.string(), lxm: l.string({ format: "nsid" }) }),
  l.jsonPayload({ token: l.string() }),
);

/** What a CGS request was for, so a refusal can say which scope was missing. */
export type RequestPurpose =
  | { readonly action: "create" | "update" | "delete"; readonly collection: string }
  | { readonly mime: string };

/** A 401 or 403 from CGS: its status and its own message. */
export interface Refusal {
  readonly status: number;
  readonly cgsMessage: string;
  readonly repo: DidString;
  readonly purpose: RequestPurpose;
}

export interface CgsRequestAuth {
  /** The headers that authenticate one request to `lxm`. Throws when none can be made, before anything is sent. */
  forRequest(lxm: NsidString, repo: DidString): Promise<{ headers: Record<string, string> }>;
  /** Plain-language message for a refusal of this kind of credential, or undefined to keep the generic one. */
  explainRefusal(operation: string, refusal: Refusal): string | undefined;
}

/**
 * A token from the signed-in account's own PDS (`getServiceAuth`, `aud` the service, `lxm` the
 * method), sent as `Authorization: Bearer`. Tokens are single-use, so one per request.
 */
export function serviceAuth(client: Client, cgs: CgsConfig, operation: string): CgsRequestAuth {
  return {
    async forRequest(lxm) {
      try {
        const { body } = await client.xrpc(getServiceAuth, {
          params: { aud: `${cgs.did}#${SERVICE_ID}`, lxm },
          service: null,
          labelers: null,
        });
        return { headers: { authorization: `Bearer ${body.token}` } };
      } catch (error) {
        throw new Error(
          `${operation}: cannot get a service-auth token for ${lxm} from the account's PDS (${describeError(error)}), so nothing was sent to the Certified Group Service. With OAuth, the session needs the scope ${scopeFor(cgs.did, lxm)} (one such scope per CGS method: createRecord, putRecord, deleteRecord and uploadBlob).`,
          { cause: error },
        );
      }
    },
    explainRefusal: () => undefined,
  };
}

/** The non-secret part of a `cgsk_<ref>.<secret>` key, safe to show in a message. */
export const keyRefOf = (key: string) => key.slice(0, key.indexOf("."));

/**
 * The group's API key, sent as `X-API-Key`. No request to a PDS. The key never appears in a message:
 * only `cgsk_<ref>` does.
 */
export function apiKeyAuth(key: string): CgsRequestAuth {
  const ref = keyRefOf(key);
  return {
    forRequest: async () => ({ headers: { "x-api-key": key } }),
    explainRefusal(operation, { status, cgsMessage, repo, purpose }) {
      if (status === 401) {
        return `${operation}: the Certified Group Service did not accept the API key ${ref}: it is unknown, revoked, or belongs to another group than ${repo}. Nothing was written. Check the key and \`repo\`, or create a new key.`;
      }
      const missing =
        "mime" in purpose
          ? `blob:${purpose.mime}`
          : `repo:${purpose.collection}?action=${purpose.action}`;
      return /scopes do not permit/i.test(cgsMessage)
        ? `${operation}: the API key ${ref} has no scope for this write, so nothing was written. Create a key with the scope ${missing}.`
        : `${operation}: the member who created the API key ${ref} may not do this in ${repo} (a key never exceeds its member's current role, for example replacing another member's record needs admin), so nothing was written.`;
    },
  };
}

/**
 * The credential for `cgs`: its API key, or a service-auth token from the context's client.
 * Throws when a session is needed and the context has no client.
 */
export function cgsRequestAuth(
  context: SDKContext,
  cgs: CgsConfig,
  operation: string,
): CgsRequestAuth {
  if (cgs.auth?.kind === "apiKey") return apiKeyAuth(cgs.auth.key);
  if (context.client === undefined) {
    throw new Error(
      `${operation}: the context has no client, so there is no account to ask for a service-auth token. Pass \`client\` to createSDKContext, or give \`cgs\` an API key with \`auth: { kind: "apiKey", key }\`.`,
    );
  }
  return serviceAuth(context.client, cgs, operation);
}
