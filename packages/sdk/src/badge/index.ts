// Entry point for @hypercerts-org/sdk/badge.

export {
  PartialWriteError,
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export type { WriteOptions } from "../write-options.js";
export type { AwardBadgeInput, AwardBadgeResult, AwardSubject } from "./award-badge.js";
export { awardBadge } from "./award-badge.js";
export type { BadgeDefinitionInput } from "./create-badge-definition.js";
export { createBadgeDefinition } from "./create-badge-definition.js";
export type { RespondToBadgeAwardInput } from "./respond-to-award.js";
export { respondToBadgeAward } from "./respond-to-award.js";
