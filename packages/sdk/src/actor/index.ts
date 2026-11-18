// Entry point for @hypercerts-org/sdk/actor.

export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ProfileInput } from "./build-profile.js";
export { createProfile, ProfileAlreadyExistsError } from "./build-profile.js";
