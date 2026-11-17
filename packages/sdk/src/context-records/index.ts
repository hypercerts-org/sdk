// Entry point for @hypercerts-org/sdk/context.
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
export {
  type AcknowledgementInput,
  type CreateAcknowledgementResult,
  createAcknowledgement,
} from "./build-acknowledgement.js";
export {
  type AttachmentInput,
  type CreateAttachmentResult,
  createAttachment,
} from "./build-attachment.js";
export {
  type CreateEvaluationResult,
  createEvaluation,
  type EvaluationInput,
} from "./build-evaluation.js";
export {
  createMeasurement,
  type MeasurementInput,
  type MeasurementResult,
} from "./build-measurement.js";
export type { EvaluationScore } from "./score.js";
