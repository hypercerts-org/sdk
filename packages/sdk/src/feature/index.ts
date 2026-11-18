// Entry point for @hypercerts-org/sdk/feature.

export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { LeafletDocument } from "../internal/long-description.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type { LocationInput, LocationValue } from "../location/build-location.js";
export type { CreateVocabularyTagResult, VocabularyTagInput } from "../tag/build-tag.js";
export type { CreateFeatureResult, FeatureInput } from "./build-feature.js";
export { createFeature } from "./build-feature.js";
