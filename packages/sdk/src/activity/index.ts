// Entry point for @hypercerts-org/sdk/activity.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { LocationInput, LocationValue } from "../location/build-location.js";
export type { WorkScopeTagInput, WorkScopeTagResult } from "../tag/build-tag.js";
export type {
  ActivityInput,
  CelWorkScopeInput,
  ContributorInput,
  ContributorResult,
  CreateActivityResult,
  InlineValue,
} from "./build-activity.js";
export { createActivity } from "./build-activity.js";
export type { ContributionInput } from "./build-contribution.js";
export { createContribution } from "./build-contribution.js";
export type { ContributorInformationInput } from "./build-contributor-information.js";
export { createContributorInformation } from "./build-contributor-information.js";
export type { RightsInput } from "./build-rights.js";
export { createRights } from "./build-rights.js";
