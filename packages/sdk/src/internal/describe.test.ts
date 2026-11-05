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

  it("describes a validation error by its issues, without a path for the value itself", () => {
    const issue = (path: string[], message: string) => ({
      path,
      message,
      toString: () => `${message} at $.${path.join(".")}`,
    });
    const error = Object.assign(new Error("ignored"), {
      error: "InvalidRequest",
      issues: [
        issue(["title"], "string too big"),
        issue([], "has an endDate before its startDate"),
      ],
    });

    expect(describeError(error)).toBe(
      "string too big at $.title, has an endDate before its startDate",
    );
  });
});
