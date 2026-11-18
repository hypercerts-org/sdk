// Entry point for @hypercerts-org/sdk/collection.
export type { ActivityEntryResult } from "../activity/activity-entry.js";
export type { ActivityInput, CreateActivityResult } from "../activity/create-activity.js";
export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { CreateFeatureResult, FeatureInput } from "../feature/create-feature.js";
export type { LeafletDocument } from "../internal/long-description.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type { LocationInput } from "../location/create-location.js";
export type { CreateVocabularyTagResult, VocabularyTagInput } from "../tag/build-tag.js";
export type {
  AddActivityToCollectionInput,
  AddActivityToCollectionResult,
} from "./add-activity-to-collection.js";
export { addActivityToCollection } from "./add-activity-to-collection.js";
export type {
  CollectionInput,
  CollectionItemInput,
  CollectionItemType,
  CreateCollectionItemResult,
  CreateCollectionResult,
} from "./build-collection.js";
export { createCollection } from "./create-collection.js";
