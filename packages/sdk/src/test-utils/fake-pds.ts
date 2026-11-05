import { Client, type ClientOptions } from "@atproto/lex";
import { createSDKContext, type SDKContext } from "../context.js";

export const DID = "did:plc:testowner123";
// CIDv1 (raw, sha-256) of the bytes "hello".
export const CID = "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq";

export interface RecordedRequest {
  path: string;
  method: string;
  headers: Headers;
  body: Uint8Array | undefined;
}

/**
 * A context whose client sends every request to `respond` instead of the network, recording what
 * the client sent. Responses go through the client's real decoding and validation.
 */
export function fakePds(
  respond: (request: RecordedRequest) => Response | Promise<Response>,
  clientOptions: ClientOptions = {},
): {
  context: SDKContext;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const client = new Client(
    {
      did: DID,
      fetchHandler: async (path, init) => {
        const request = {
          path,
          method: init.method ?? "GET",
          headers: new Headers(init.headers),
          body:
            init.body == null
              ? undefined
              : new Uint8Array(await new Response(init.body).arrayBuffer()),
        };
        requests.push(request);
        return respond(request);
      },
    },
    clientOptions,
  );
  return { context: createSDKContext({ client }), requests };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
