// Entry point for @hypercerts-org/sdk/context.

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
  type CreateMeasurementResult,
  createMeasurement,
  type MeasurementInput,
} from "./build-measurement.js";
export type { EvaluationScore } from "./score.js";
