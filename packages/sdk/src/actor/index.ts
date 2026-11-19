// Entry point for @hypercerts-org/sdk/actor.

export {
  PartialWriteError,
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { WriteOptions } from "../write-options.js";
export type { ProfileInput } from "./create-profile.js";
export { createProfile, ProfileAlreadyExistsError } from "./create-profile.js";
