// Entry point for @hypercerts-org/sdk/location.

export {
  PartialWriteError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { WriteOptions } from "../write-options.js";
export type { LocationInput, LocationValue } from "./create-location.js";
export { createLocation } from "./create-location.js";
