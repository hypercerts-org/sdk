// Entry point for @hypercerts-org/sdk/feature.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { LocationInput, LocationValue } from "../location/build-location.js";
export type { VocabularyTagInput, VocabularyTagResult } from "../tag/build-tag.js";
export type { CreateFeatureResult, FeatureInput, LeafletDocument } from "./build-feature.js";
export { createFeature } from "./build-feature.js";
