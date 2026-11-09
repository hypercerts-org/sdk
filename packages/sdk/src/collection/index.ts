// Entry point for @hypercerts-org/sdk/collection.
export type { ActivityInput, CreateActivityResult } from "../activity/build-activity.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type {
  CreateActivityInCollectionInput,
  CreateActivityInCollectionResult,
} from "./create-activity-in-collection.js";
export { createActivityInCollection } from "./create-activity-in-collection.js";
