import type { SDKContext } from "../context.js";
import { createBuildContext } from "../internal/build-context.js";
import { submitWrites } from "../internal/submit-writes.js";
import { type CreateProjectResult, type ProjectInput, prepareProject } from "./build-project.js";

const OPERATION = "createProject";

/**
 * Creates a Project (an `org.hypercerts.collection` of type `project`) with its Activities and
 * their supporting records, in one atomic write.
 *
 * @remarks
 * Use this to publish work. An Activity on its own may not show up or work in other apps in the
 * ecosystem; apps expect a Project (a Collection of type `project` that holds its Activities). That
 * is why `createProject` exists. See {@link createActivity} for an Activity by itself.
 *
 * A Project is a Collection whose items are Activities, so the input is {@link createCollection}'s
 * without `type` (always `project`) and `items`, with `activities` in their place. Each entry of
 * `activities` is exactly one of `{ activity }` (the data of a new Activity, created with the same
 * rules as {@link createActivity}) or `{ uri }` (an existing Activity, reused as it is), with an
 * optional `weight`. The choice is explicit; the SDK never guesses it from the fields. `location`
 * and `tags` are the data of a new record or `{ uri }` of an existing one, as in `createCollection`.
 *
 * A Project always has an Activity. When `activities` is omitted or empty, the SDK creates one
 * default Activity from the Project. It copies the Project's `title`, `shortDescription`,
 * `shortDescriptionFacets`, `description` (text, a Leaflet document, or the same `{ uri }`
 * reference) and `langs` as they are, and its `banner` as the Activity's `image`: a URL is copied as
 * a URL, and a file is uploaded again for the Activity (once for each record) if it is at most 5 MB.
 * A larger banner is left out of the Activity without an error, because the Project's banner holds
 * up to 10 MB and the Activity's image 5 MB; the Project keeps its banner. It copies nothing else:
 * not `location`, `tags`, `avatar` or `createdAt` (the Activity's is the time of the call), and it
 * sets no rights, contributors or dates. The Activity's limits are tighter than the Project's (its
 * title holds at most 256 bytes, where a Project's holds 800 in at most 80 graphemes), and the SDK
 * never shortens a value to fit: a `title` the Activity does not allow, or a missing
 * `shortDescription`, throws a `TypeError`; pass `activities` to keep such a title. A value the
 * Project itself does not allow throws as the Project's own error, whatever `activities` holds. A
 * non-empty `activities` creates no default Activity.
 *
 * References: every `{ uri }` (an Activity in `activities`, `location`, an entry of `tags`, a
 * `description`) is a strong reference. The record is read once to learn its current CID, which
 * the Project stores, and is never rewritten; it may belong to another account if it is public. A
 * `uri` that cannot be read stops the call. An Activity `uri` must be an Activity: a Feature or a
 * Collection throws a `TypeError`, and so does a handle in place of a DID. Nothing is searched for
 * or deduplicated: the same data twice creates two records, and the same `uri` twice lists the
 * Activity twice. Order is kept, and weights are stored as the strings you pass; they are not
 * normalised.
 *
 * Everything is created in one `com.atproto.repo.applyWrites` request, which the PDS commits as a
 * whole: all the records exist afterwards, or none do. One write holds at most 200 records, the
 * Project and every record nested in it included; the SDK never splits a call, so a larger one
 * throws before anything is read or uploaded. Create some records first and pass them as `{ uri }`.
 * The session needs `create` on every collection it writes to.
 *
 * A new tag's record key is `<category>.<key>`, so the SDK checks first that no such tag exists and
 * throws {@link RecordAlreadyExistsError} if one does; use the existing tag's `uri` instead.
 *
 * Order: validate input, count records, read existing records and tag keys, upload blobs, build,
 * write. Input and read errors stop before any upload; a rejected file or lexicon rule is found
 * at build time, after other files may have uploaded. Uploaded blobs are not rolled back; see
 * {@link uploadBlob}. Errors name the field as you passed it, for example
 * `input.activities[1].activity.title`.
 *
 * Not supported: a Project's `type` or `items`, Features or child Collections in a Project (use
 * {@link createCollection}), the lexicon's `signatures`, adding Activities to a Project that
 * exists, and changing an existing record.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The Project, its Activities and the records it needs. See {@link ProjectInput}.
 * @returns The new Project's URI and CID, and what was created or reused for its location, tags and
 * Activities, in input order. See {@link CreateProjectResult}.
 * @throws {@link TypeError} If `input` has `type`, `items` or an unknown field, an entry of
 * `activities` that is not exactly one of `{ activity }` and `{ uri }`, a `uri` that is not an
 * Activity (or a location or tag of the wrong type), no `shortDescription` or a `title` the
 * default Activity does not allow, more than 1000 `activities`, an invalid weight (not a positive
 * decimal, or over 100 characters), a nested record that is invalid, more new records than one
 * write holds, or any value the lexicons do not allow. The
 * message names the field. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, the
 * key of a new tag cannot be checked, or an upload fails. Nothing was written.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to retry:
 * a successful first attempt would be duplicated. `attempted` lists the new records, Project last.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example A Project with the default Activity
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * // `context` comes from createSDKContext.
 * const project = await createProject(context, {
 *   title: "Phobjikha valley restoration",
 *   shortDescription: "Restoring the valley's forests and wetlands.",
 *   description: "Longer text. The default Activity copies it too.",
 *   location: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // not copied
 * });
 * console.log(project.uri); // at://…/org.hypercerts.collection/…
 * console.log(project.activities[0]); // { uri, cid, created: true, locations: [], contributors: [] }
 * ```
 *
 * @example New and existing Activities, with weights
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * await createProject(context, {
 *   title: "Phobjikha valley restoration",
 *   location: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // reused
 *   tags: [{ category: "theme", key: "forest", name: "Forest", status: "accepted" }], // created
 *   activities: [
 *     {
 *       activity: {
 *         title: "Reforestation in the Phobjikha valley",
 *         shortDescription: "Planting 5,000 native trees.",
 *       },
 *       weight: "2", // created
 *     },
 *     { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8", weight: "0.5" }, // reused
 *   ],
 * });
 * ```
 *
 * @example An entry is not a bare Activity
 * ```ts
 * import { createProject } from "@hypercerts-org/sdk/project";
 *
 * await createProject(context, {
 *   title: "Phobjikha valley restoration",
 *   // TypeError: an entry is { activity } or { uri }
 *   activities: [{ title: "Reforestation", shortDescription: "Planting trees." } as never],
 * });
 * ```
 *
 * @example Handling an unknown outcome
 * ```ts
 * import { createProject, WriteOutcomeUnknownError } from "@hypercerts-org/sdk/project";
 *
 * try {
 *   await createProject(context, input);
 * } catch (error) {
 *   if (error instanceof WriteOutcomeUnknownError) {
 *     // The Project is last. Check it with com.atproto.repo.getRecord: the write is
 *     // all-or-nothing, so if it exists, every record in `attempted` does.
 *     console.log(error.attempted.map((ref) => ref.uri));
 *   }
 *   throw error;
 * }
 * ```
 */
export async function createProject(
  context: SDKContext,
  input: ProjectInput,
): Promise<CreateProjectResult> {
  const build = createBuildContext(context, OPERATION);
  const { writes, result } = await prepareProject(build, input);
  await submitWrites(context, build.did, writes, OPERATION);
  return result;
}
