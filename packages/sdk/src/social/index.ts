// Entry point for @hypercerts-org/sdk/social.
//
// Covers the social graph and feed records: follows and entity follows (`app.certified.graph.*`)
// and likes and reposts (`app.certified.feed.*`), with the operations that undo them.

export {
  WriteError,
  WriteOutcomeUnknownError,
  WriteRejectedError,
  WriteResultMismatchError,
} from "../errors.js";
export type { StrongRef } from "../internal/resolve-record-ref.js";
export type {
  ActionOptions,
  FollowAccountInput,
  RecordActionInput,
  RecordTarget,
  UndoTarget,
  UnfollowAccountInput,
  UnfollowEntityInput,
  UnlikeInput,
  UnrepostInput,
} from "./action.js";
export { like, repost, unlike, unrepost } from "./feed.js";
export { followAccount, followEntity, unfollowAccount, unfollowEntity } from "./graph.js";
