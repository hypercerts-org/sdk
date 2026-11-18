// Entry point for @hypercerts-org/sdk/project.
export type { ActivityEntry, ActivityEntryResult } from "../activity/activity-entry.js";
export type { ActivityInput, CreateActivityResult } from "../activity/build-activity.js";
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
export type { LocationInput } from "../location/build-location.js";
export type { CreateVocabularyTagResult, VocabularyTagInput } from "../tag/build-tag.js";
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
