// Entry point for @hypercerts-org/sdk/badge.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type { AwardBadgeInput, AwardBadgeResult, AwardSubject } from "./award-badge.js";
export { awardBadge } from "./award-badge.js";
export type { BadgeDefinitionInput } from "./build-definition.js";
export { createBadgeDefinition } from "./build-definition.js";
export type { RespondToBadgeAwardInput } from "./respond-to-award.js";
export { respondToBadgeAward } from "./respond-to-award.js";
