// Entry point for @hypercerts-org/sdk/tag.

export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type {
  CreateVocabularyTagResult,
  CreateWorkScopeTagResult,
  TagFields,
  VocabularyTagInput,
  WorkScopeTagInput,
} from "./build-tag.js";
export { createVocabularyTag, createWorkScopeTag } from "./build-tag.js";
