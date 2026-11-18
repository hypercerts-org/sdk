// Entry point for @hypercerts-org/sdk/location.

export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { LocationInput, LocationValue } from "./create-location.js";
export { createLocation } from "./create-location.js";
