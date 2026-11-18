import { addActivity } from "../collection/add-activity.js";
import type {
  AddActivityToCollectionInput,
  AddActivityToCollectionResult,
} from "../collection/add-activity-to-collection.js";
import type { SDKContext } from "../context.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";

const OPERATION = "addActivityToProject";

/**
 * The input of {@link addActivityToProject}: {@link AddActivityToCollectionInput} with `projectUri`
 * in place of `collectionUri`.
 */
export interface AddActivityToProjectInput
  extends Omit<AddActivityToCollectionInput, "collectionUri"> {
  /**
   * The Project to add to, as `at://<did>/org.hypercerts.collection/<rkey>`: a Collection of type
   * `project` that belongs to the account the client is signed in as, identified by a DID.
   */
  projectUri: string;
}

/**
 * The result of {@link addActivityToProject}: {@link AddActivityToCollectionResult} with `project`
 * in place of `collection`.
 */
export interface AddActivityToProjectResult
  extends Omit<AddActivityToCollectionResult, "collection"> {
  /** The Project after the update: its unchanged URI and the CID of its new version. */
  project: StrongRef;
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
 * @returns The Activity (`created` is `false` for `{ uri }`) and the Project's new version.
 * @throws {@link TypeError} If the input is invalid, or the Collection is not your own Project.
 * @throws {@link WriteRejectedError} If the PDS rejected the write, including `"InvalidSwap"`.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to retry.
 *
 * @example
 * ```ts
 * import { addActivityToProject } from "@hypercerts-org/sdk/project";
 *
 * // `context` comes from createSDKContext. `activity` is { activity } or { uri }, never bare data.
 * const { activity, project } = await addActivityToProject(context, {
 *   projectUri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8",
 *   activity: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *   weight: "2",
 * });
 * ```
 */
export async function addActivityToProject(
  context: SDKContext,
  input: AddActivityToProjectInput,
): Promise<AddActivityToProjectResult> {
  const { collection, ...added } = await addActivity(
    context,
    OPERATION,
    {
      uriField: "projectUri",
      noun: "Project",
      check: ({ type }, uri) => {
        if (type === "project") return;
        const actual = type === undefined ? "has no type" : `has type ${JSON.stringify(type)}`;
        throw new TypeError(
          `${OPERATION}: projectUri points at a Collection that ${actual}, but a Project has type "project": ${uri}. To add to any Collection, use addActivityToCollection from @hypercerts-org/sdk/collection.`,
        );
      },
    },
    input,
  );
  return { ...added, project: collection };
}
