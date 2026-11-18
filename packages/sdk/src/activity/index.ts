// Entry point for @hypercerts-org/sdk/activity.

export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { LeafletDocument } from "../internal/long-description.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type { LocationInput, LocationValue } from "../location/create-location.js";
export type { CreateWorkScopeTagResult, WorkScopeTagInput } from "../tag/build-tag.js";
export type {
  ActivityInput,
  CelWorkScopeInput,
  ContributorInput,
  ContributorResult,
  CreateActivityResult,
  InlineValue,
} from "./create-activity.js";
export { createActivity } from "./create-activity.js";
export type { ContributionInput } from "./create-contribution.js";
export { createContribution } from "./create-contribution.js";
export type { ContributorInformationInput } from "./create-contributor-information.js";
export { createContributorInformation } from "./create-contributor-information.js";
export type { RightsInput } from "./create-rights.js";
export { createRights } from "./create-rights.js";
