import type { SDKContext } from "../context.js";
import { createBuildContext } from "../internal/build-context.js";
import { submitWrites } from "../internal/submit-writes.js";
import type { WriteOptions } from "../write-options.js";
import { type CreateProjectResult, type ProjectInput, prepareProject } from "./build-project.js";

const OPERATION = "createProject";

/**
 * Creates a Project (a Collection of type `project`) with its Activities in one atomic write.
 *
 * @remarks
 * Use this to publish work. An Activity on its own may not show up in other apps; they expect a
 * Project that holds its Activities.
 *
 * The input is {@link createCollection}'s without `type` and `items`, plus `activities`: each entry
 * is `{ activity, weight? }`, where `activity` is the data of a new Activity or `{ uri }` of an
 * existing one, and `weight` is kept as written.
 *
 * With no `activities`, one Activity is created from the Project. It copies the title,
 * `shortDescription` (and its facets), description and langs, and uses the banner as its image (a
 * file is uploaded once and reused, and skipped if over 5 MB). A missing `shortDescription`, or a
 * title too long for an Activity, throws: the SDK never shortens a value.
 *
 * Each `{ uri }` is read once for its CID and never changed. The write holds at most 200 records
 * and is never split. See the SDK skill reference for ordering, tag key checks, errors and
 * rollback.
 *
 * @param context - The shared context from {@link createSDKContext}, with an authenticated client.
 * @param input - The Project and its Activities. See {@link ProjectInput}.
 * @param options - Optional. `{ repo }`: the DID of an organization to write to through the Certified Group Service instead of the account's own repository; see {@link WriteOptions}. Needs `cgs` on the context.
 * @returns The new Project's URI and CID, and what was created or reused. See
 * {@link CreateProjectResult}.
 * @throws {@link TypeError} If the input is not valid. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write. Nothing was created.
 * @throws {@link PartialWriteError} For organization writes through CGS, if a write fails after at least one record of the call was written. Nothing is rolled back.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to call again:
 * a retry can duplicate records under new keys. `attempted` lists the new records, Project last.
 *
 * @example A Project with the default Activity
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * // `context` comes from createSDKContext.
 * const project = await createProject(context, {
 *   title: "Phobjikha valley restoration",
 *   shortDescription: "Restoring the valley's forests and wetlands.",
 * });
 * console.log(project.uri, project.activities[0].uri);
 * ```
 *
 * @example New and existing Activities, with weights
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * await createProject(context, {
 *   title: "Phobjikha valley restoration",
 *   activities: [
 *     { activity: { title: "Reforestation", shortDescription: "Planting trees." }, weight: "2" },
 *     {
 *       activity: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *       weight: "0.5",
 *     },
 *   ],
 * });
 * ```
 */
export async function createProject(
  context: SDKContext,
  input: ProjectInput,
  options?: WriteOptions,
): Promise<CreateProjectResult> {
  const build = createBuildContext(context, OPERATION, options);
  const { writes, result } = await prepareProject(build, input);
  await submitWrites(build, writes);
  return result;
}
