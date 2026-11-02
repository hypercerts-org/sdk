import { afterEach, describe, expect, it, vi } from "vitest";
import { json } from "../test-utils/fake-pds.js";
import { resolvePds } from "./resolve-pds.js";

const PDS = {
  id: "#atproto_pds",
  type: "AtprotoPersonalDataServer",
  serviceEndpoint: "https://pds.example",
};

function serve(documents: Record<string, unknown>): string[] {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    return url in documents ? json(200, documents[url]) : json(404, {});
  });
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePds", () => {
  it("reads a did:plc document from plc.directory", async () => {
    serve({ "https://plc.directory/did:plc:abc": { id: "did:plc:abc", service: [PDS] } });

    expect(String(await resolvePds("did:plc:abc"))).toBe("https://pds.example/");
  });

  it("reads a did:web document from the host's well-known path, including a port", async () => {
    const did = "did:web:example.com%3A8443";
    serve({
      "https://example.com:8443/.well-known/did.json": {
        id: did,
        service: [{ ...PDS, id: `${did}#atproto_pds` }],
      },
    });

    expect(String(await resolvePds(did))).toBe("https://pds.example/");
  });

  it("rejects did:web with a path and other DID methods before fetching", async () => {
    const fetched = serve({});

    await expect(resolvePds("did:web:example.com:user:alice")).rejects.toThrow(
      /only did:plc and host-only did:web are supported/,
    );
    await expect(resolvePds("did:key:z6Mk")).rejects.toThrow(/only did:plc/);
    expect(fetched).toHaveLength(0);
  });

  it.each([
    ["belongs to another DID", { id: "did:plc:other", service: [PDS] }, /DID document is invalid/],
    ["has no PDS service", { id: "did:plc:abc", service: [] }, /lists no atproto PDS/],
    [
      "has a PDS service with a non-http endpoint",
      { id: "did:plc:abc", service: [{ ...PDS, serviceEndpoint: "ftp://pds.example" }] },
      /lists no atproto PDS/,
    ],
  ])("fails when the document %s", async (_, document, message) => {
    serve({ "https://plc.directory/did:plc:abc": document });

    await expect(resolvePds("did:plc:abc")).rejects.toThrow(message);
  });
});
