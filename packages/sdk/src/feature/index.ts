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
export type { LocationInput, LocationValue } from "../location/create-location.js";
export type { CreateVocabularyTagResult, VocabularyTagInput } from "../tag/build-tag.js";
export type { CreateFeatureResult, FeatureInput } from "./create-feature.js";
export { createFeature } from "./create-feature.js";
