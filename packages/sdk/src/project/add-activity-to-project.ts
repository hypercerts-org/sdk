import type { ActivityEntryResult } from "../activity/activity-entry.js";
import { addActivity } from "../collection/add-activity.js";
import type { AddActivityToCollectionInput } from "../collection/add-activity-to-collection.js";
import type { SDKContext } from "../context.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import type { ExistingRecord } from "../internal/slots.js";

const OPERATION = "addActivityToProject";

/**
 * The input of {@link addActivityToProject}: {@link AddActivityToCollectionInput} with `project` in
 * place of `collection`.
 */
export interface AddActivityToProjectInput
  extends Omit<AddActivityToCollectionInput, "collection"> {
  /**
   * The Project to add to: `{ uri }` as `at://<did>/org.hypercerts.collection/<rkey>`, a Collection
   * of type `project` that belongs to the account the client is signed in as, identified by a DID.
   */
  project: ExistingRecord;
}

/**
 * The result of {@link addActivityToProject}: the Project's new version as `uri` and `cid`, and the
 * Activity as `activity`. Same shape as {@link AddActivityToCollectionResult}.
 */
export interface AddActivityToProjectResult extends StrongRef {
  /** The Activity, created or reused. See {@link ActivityEntryResult}. */
  activity: ActivityEntryResult;
}

/**
 * Adds an Activity to an existing Project (a Collection of type `project`) in one atomic write.
 *
 * @remarks
 * Works like {@link addActivityToCollection}, which also covers the `activity` forms, the
 * concurrency check and what is not deduplicated or re-signed. It also checks that the Collection's
 * type is `project`; a Collection of another type is refused with a `TypeError`.
 *
 * @param context - The shared context from {@link createSDKContext}, with an authenticated client.
 * @param input - The Project, the Activity and an optional weight.
 * @returns The Project's new version as `uri` and `cid`, and the Activity as `activity` (`created` is
 * `false` for `{ uri }`).
 * @throws {@link TypeError} If the input is invalid, or the Collection is not your own Project.
 * @throws {@link WriteRejectedError} If the PDS rejected the write, including `"InvalidSwap"`.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to call again:
 * a retry can duplicate records under new keys.
 *
 * @example
 * ```ts
 * import { addActivityToProject } from "@hypercerts-org/sdk/project";
 *
 * // `context` comes from createSDKContext. `activity` is the data of a new Activity or { uri }.
 * const { uri, cid, activity } = await addActivityToProject(context, {
 *   project: { uri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8" },
 *   activity: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *   weight: "2",
 * });
 * ```
 */
export async function addActivityToProject(
  context: SDKContext,
  input: AddActivityToProjectInput,
): Promise<AddActivityToProjectResult> {
  return addActivity(
    context,
    OPERATION,
    {
      field: "project",
      noun: "Project",
      check: ({ type }, uri) => {
        if (type === "project") return;
        const actual = type === undefined ? "has no type" : `has type ${JSON.stringify(type)}`;
        throw new TypeError(
          `${OPERATION}: project.uri points at a Collection that ${actual}, but a Project has type "project": ${uri}. To add to any Collection, use addActivityToCollection from @hypercerts-org/sdk/collection.`,
        );
      },
    },
    input,
  );
}
