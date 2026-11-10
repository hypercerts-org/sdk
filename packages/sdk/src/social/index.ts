// Entry point for @hypercerts-org/sdk/social.
//
// Covers the social graph and feed records: follows and entity follows (`app.certified.graph.*`)
// and likes and reposts (`app.certified.feed.*`), with the operations that undo them.
export type { StrongRef } from "../internal/resolve-record-ref.js";
export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../internal/submit-writes.js";
export type {
  ActionOptions,
  FollowAccountInput,
  RecordActionInput,
  RecordTargetInput,
  UndoResult,
  UnfollowAccountInput,
} from "./action.js";
export { like, repost, unlike, unrepost } from "./feed.js";
export { followAccount, followEntity, unfollowAccount, unfollowEntity } from "./graph.js";
