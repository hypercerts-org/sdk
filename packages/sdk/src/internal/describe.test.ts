import { describe, expect, it } from "vitest";
import { describeError } from "./describe.js";

describe("describeError", () => {
  it("prefixes the XRPC error code", () => {
    const error = Object.assign(new Error("Blob too large"), { error: "BlobTooLarge" });

    expect(describeError(error)).toBe("BlobTooLarge: Blob too large");
  });

  it("appends the cause when the message is generic", () => {
    const error = Object.assign(
      new Error("Unable to fulfill XRPC request", { cause: new Error("Invalid header value") }),
      { error: "InternalServerError" },
    );

    expect(describeError(error)).toBe(
      "InternalServerError: Unable to fulfill XRPC request: Invalid header value",
    );
  });

  it("does not repeat a cause the message already contains", () => {
    const error = new Error("Unexpected fetchHandler() error: fetch failed", {
      cause: new Error("fetch failed"),
    });

    expect(describeError(error)).toBe("Unexpected fetchHandler() error: fetch failed");
  });
});
