// Entry point for @hypercerts-org/sdk/collection.
export type { ActivityInput, CreateActivityResult } from "../activity/build-activity.js";
export type {
  CreateFeatureResult,
  FeatureInput,
  LeafletDocument,
} from "../feature/build-feature.js";
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
export type { VocabularyTagInput, VocabularyTagResult } from "../tag/build-tag.js";
export type {
  CollectionInput,
  CollectionItemInput,
  CollectionItemType,
  CreateCollectionItemResult,
  CreateCollectionResult,
} from "./build-collection.js";
export type {
  CreateActivityInCollectionInput,
  CreateActivityInCollectionResult,
} from "./create-activity-in-collection.js";
export { createActivityInCollection } from "./create-activity-in-collection.js";
export { createCollection } from "./create-collection.js";
