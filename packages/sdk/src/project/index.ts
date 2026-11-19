// Entry point for @hypercerts-org/sdk/project.
export type { ActivityEntryResult } from "../activity/activity-entry.js";
export type { ActivityInput, CreateActivityResult } from "../activity/create-activity.js";
export {
  PartialWriteError,
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { LeafletDocument } from "../internal/long-description.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type { LocationInput } from "../location/create-location.js";
export type { CreateVocabularyTagResult, VocabularyTagInput } from "../tag/build-tag.js";
export type { WriteOptions } from "../write-options.js";
export type {
  AddActivityToProjectInput,
  AddActivityToProjectResult,
} from "./add-activity-to-project.js";
export { addActivityToProject } from "./add-activity-to-project.js";
export type {
  CreateProjectResult,
  ProjectActivityInput,
  ProjectActivityResult,
  ProjectInput,
} from "./build-project.js";
export { createProject } from "./create-project.js";
