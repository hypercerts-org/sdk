// Entry point for @hypercerts-org/sdk/location.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { LocationInput, LocationValue } from "./build-location.js";
export { createLocation } from "./build-location.js";
