import { currentDatetimeString, type TypedBlobRef } from "@atproto/lex";
import * as rightsLexicon from "@hypercerts-org/lexicon/org/hypercerts/claim/rights";
import * as defs from "@hypercerts-org/lexicon/org/hypercerts/defs";
import { beforeAll, describe, expect, it } from "vitest";
import { uploadBlob } from "../src/blob/index.js";
import { rights, unique } from "./fixtures.js";
import { expectBlobServed } from "./records.js";
import { type Account, loginAs } from "./session.js";

let user: Account;
beforeAll(async () => {
  user = await loginAs("user1");
});

// A PDS serves a blob only after a record in the repo references it. This writes the smallest
// record that does, the way an application would after `uploadBlob`.
async function referenceFrom(blob: TypedBlobRef): Promise<void> {
  await user.client.create(rightsLexicon.main, {
    ...rights,
    attachment: defs.smallBlob.build({ blob }),
    createdAt: currentDatetimeString(),
  });
}

describe("uploadBlob", () => {
  it("uploads a File, using its own type, and the PDS serves the bytes back", async () => {
    const bytes = new TextEncoder().encode(unique("note"));

    const blob = await uploadBlob(
      user.context,
      new File([bytes], "note.txt", { type: "text/plain" }),
    );

    expect(blob.mimeType).toBe("text/plain");
    await referenceFrom(blob);
    await expectBlobServed(user.client, user.did, blob, bytes);
  });

  it("uploads a Uint8Array with an explicit MIME type and the PDS serves the bytes back", async () => {
    // Bytes the PDS has never seen: it deduplicates blobs by content.
    const bytes = new TextEncoder().encode(unique("report"));

    const blob = await uploadBlob(user.context, bytes, { mimeType: "application/pdf" });

    expect(blob.mimeType).toBe("application/pdf");
    await referenceFrom(blob);
    await expectBlobServed(user.client, user.did, blob, bytes);
  });
});
