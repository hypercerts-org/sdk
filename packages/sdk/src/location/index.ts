// Entry point for @hypercerts-org/sdk/location.

export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { LocationInput, LocationValue } from "./build-location.js";
export { createLocation } from "./build-location.js";
