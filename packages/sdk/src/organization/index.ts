// Entry point for @hypercerts-org/sdk/organization.

// The types of the inputs that `OrganizationInput` and `CreateOrganizationInput` embed, and the
// errors a write can end with.
export type { ProfileInput } from "../actor/build-profile.js";
export type { LeafletDocument } from "../internal/long-description.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { LocationInput } from "../location/build-location.js";
export type { OrganizationInput, OrganizationUrl } from "./build-organization.js";
export type {
  CreateOrganizationInput,
  CreateOrganizationResult,
  OrganizationProfileRef,
} from "./create-organization.js";
export { createOrganization, OrganizationAlreadyExistsError } from "./create-organization.js";
