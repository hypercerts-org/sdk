// Entry point for @hypercerts-org/sdk/actor.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { ProfileInput } from "./build-profile.js";
export { createProfile, ProfileAlreadyExistsError } from "./build-profile.js";
