import { vi } from "vitest";

/**
 * Sends requests for `https://plc.directory` to the PLC directory of the sandbox instead.
 *
 * @remarks
 * To reuse another account's record, the SDK finds that account's PDS from its DID document, and
 * it always asks plc.directory. The sandbox's accounts exist only in its own PLC directory, so
 * without this the lookup answers "not found". Call `vi.unstubAllGlobals()` to undo it.
 */
export function redirectPlcDirectory(sandboxPlcUrl: string): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://plc.directory") return realFetch(input, init);
    const target = new URL(url.pathname + url.search, sandboxPlcUrl);
    return realFetch(input instanceof Request ? new Request(target, input) : target, init);
  });
}
