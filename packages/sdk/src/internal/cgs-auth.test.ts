import type { Client } from "@atproto/lex";
import { describe, expect, it } from "vitest";
import { serviceAuth } from "./cgs-auth.js";

describe("serviceAuth.explainRefusal", () => {
  const auth = serviceAuth(
    {} as Client,
    { url: "https://cgs.test", did: "did:web:cgs.test" },
    "op",
  );
  const refusal = (status: number, cgsMessage: string) => ({
    status,
    cgsMessage,
    repo: "did:plc:group" as const,
    purpose: { mime: "image/png" },
  });

  it("tells a caller whose CGS uses a custom service DID to pass cgs.did", () => {
    const message = auth.explainRefusal(
      "op",
      refusal(401, "jwt audience does not match service did"),
    );

    expect(message).toContain("If this CGS uses a custom service DID, pass cgs.did.");
  });

  it("leaves other refusals to the generic message", () => {
    expect(auth.explainRefusal("op", refusal(401, "Invalid audience"))).toBeUndefined();
    expect(auth.explainRefusal("op", refusal(403, "audience does not match"))).toBeUndefined();
  });
});
