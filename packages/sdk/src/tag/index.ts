// Entry point for @hypercerts-org/sdk/tag.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export {
  RecordAlreadyExistsError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type {
  TagFields,
  VocabularyTagInput,
  VocabularyTagResult,
  WorkScopeTagInput,
  WorkScopeTagResult,
} from "./build-tag.js";
export { createVocabularyTag, createWorkScopeTag } from "./build-tag.js";
