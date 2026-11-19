import { addActivity } from "../collection/add-activity.js";
import type {
  AddActivityToCollectionInput,
  AddActivityToCollectionResult,
} from "../collection/add-activity-to-collection.js";
import type { SDKContext } from "../context.js";
import type { ExistingRecord } from "../internal/slots.js";
import type { WriteOptions } from "../write-options.js";

const OPERATION = "addActivityToProject";

/**
 * The input of {@link addActivityToProject}: {@link AddActivityToCollectionInput} with `project` in
 * place of `collection`.
 */
export interface AddActivityToProjectInput
  extends Omit<AddActivityToCollectionInput, "collection"> {
  /**
   * The Project to add to: `{ uri }` as `at://<did>/org.hypercerts.collection/<rkey>`, a Collection
   * of type `project` in the repository written to (your own, or `{ repo }`), identified by a DID.
   */
  project: ExistingRecord;
}

/**
 * The result of {@link addActivityToProject}: the Project's new version as `uri` and `cid`, and the
 * Activity as `activity`. Same shape as {@link AddActivityToCollectionResult}.
 */
export type AddActivityToProjectResult = AddActivityToCollectionResult;

/**
 * Adds an Activity to an existing Project (a Collection of type `project`) in one atomic write.
 *
 * @remarks
 * Works like {@link addActivityToCollection}, which also covers the `activity` forms, the
 * concurrency check and what is not deduplicated or re-signed. It also checks that the Collection's
 * type is `project`; a Collection of another type is refused with a `TypeError`.
 *
 * With `{ repo: orgDid }` the Project must be in the organization's repository. A new Activity is
 * created first, then the Project is replaced with one `putRecord` guarded by the Project's own
 * version (`swapRecord`), so a concurrent change to it is still refused. The repository-wide
 * `swapCommit` that guards the account's own repository when a new Activity is created is not
 * available through the Certified Group Service and is not sent: another write to the organization
 * that does not touch the Project is not detected. If the update fails after the Activity was created,
 * {@link PartialWriteError} says so; pass the new Activity as `{ uri }` to try again, but only when
 * the Project update was rejected. When its `failure` is a {@link WriteOutcomeUnknownError}, the
 * update may have landed: read the Project first, because adding the Activity again appends a
 * second item (items are not deduplicated). Replacing a
 * Project that another member created needs the admin role.
 *
 * @param context - The shared context from {@link createSDKContext}, with an authenticated client.
 * @param input - The Project, the Activity and an optional weight.
 * @param options - Optional. `{ repo }`: the DID of an organization to write to through the Certified Group Service instead of the account's own repository; see {@link WriteOptions}. Needs `cgs` on the context.
 * @returns The Project's new version as `uri` and `cid`, and the Activity as `activity` (`created` is
 * `false` for `{ uri }`).
 * @throws {@link TypeError} If the input is invalid, or the Collection is not your own Project.
 * @throws {@link WriteRejectedError} If the PDS rejected the write, including `"InvalidSwap"`: the
 * Project changed since it was read (`activity: { uri }`), or the repository did (a new Activity).
 * @throws {@link PartialWriteError} For organization writes through CGS, if a write fails after at least one record of the call was written. Nothing is rolled back.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to call again:
 * a retry can duplicate new records under new keys. For `activity: { uri }` only the Project was written
 * (one `putRecord`): its stored CID is no proof either way. Compare it with the Project entry of `attempted`:
 * a match means the append applied, so do not call again. Any other CID is inconclusive (another writer
 * may have changed the Project before or after the append), so check `items` by hand and keep the outcome
 * unknown if that cannot settle it; a retry re-reads the Project and can add the item twice.
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
  options?: WriteOptions,
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
    options,
  );
}
