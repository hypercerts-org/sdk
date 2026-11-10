import { l } from "@atproto/lex";
import * as evaluation from "@hypercerts-org/lexicon/org/hypercerts/context/evaluation";
import { type RecordKind, recordKind, references } from "../internal/record-kind.js";
import type { ExistingRecord, SupportingRecordRef } from "../internal/slots.js";
import type { LocationInput } from "../location/build-location.js";
import {
  type MeasurementInput,
  type MeasurementResult,
  measurementKind,
} from "./build-measurement.js";
import { type EvaluationScore, scoreInput } from "./score.js";
import {
  contentInput,
  contentTransform,
  creatorOf,
  didListInput,
  didListTransform,
  existingRecordReference,
  locationReference,
} from "./shared.js";

/** The data of a new `org.hypercerts.context.evaluation` record. */
export interface EvaluationInput {
  /**
   * DIDs of the evaluators, at most 1000. Declared data: it is not proof that those accounts wrote
   * or agree with the evaluation, and nothing is sent to them. The SDK does not default it to the
   * signed-in account.
   */
  evaluators: readonly string[];
  /** A brief summary. At most 5000 characters and 1000 graphemes. */
  summary: string;
  /**
   * What is being evaluated: `{ uri }` of an existing record of any type (an Activity, a
   * measurement, a contribution, ...). Pinned by the CID read before the write and never modified.
   */
  subject?: ExistingRecord | undefined;
  /**
   * Detailed reports or methodology, at most 100, in order: each `Blob` or `File` (up to 10 MB, any
   * type) is uploaded by the SDK, and each string is stored as a URL and never fetched.
   */
  content?: readonly (Blob | string)[] | undefined;
  /**
   * The measurements the evaluation is based on, at most 100: each entry is the data of a new
   * measurement (created in the same write, with its own new `locations`) or `{ uri }` of an
   * existing `org.hypercerts.context.measurement`, reused as it is.
   */
  measurements?: readonly (MeasurementInput | ExistingRecord)[] | undefined;
  /** An overall score. See {@link EvaluationScore}. */
  score?: EvaluationScore | undefined;
  /**
   * For a georeferenced evaluation: the data of a new location or `{ uri }` of an existing one.
   */
  location?: LocationInput | ExistingRecord | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

/**
 * The result of {@link createEvaluation}: the new Evaluation's URI and CID with `created: true`,
 * and the results for the records it points at.
 *
 * @remarks
 * `subject`, `measurements` and `location` mirror the input and appear only when the input had
 * them. `measurements[i]` belongs to the input entry at the same index, whether it was created or
 * reused, and a new measurement reports its own `locations`. Filter on `created` for only the
 * records this call wrote.
 */
export interface CreateEvaluationResult extends SupportingRecordRef {
  /** The subject with the CID it was pinned at. `created` is `false`. */
  subject?: SupportingRecordRef;
  /** The measurements, in input order. */
  measurements?: readonly MeasurementResult[];
  /** The location. */
  location?: SupportingRecordRef;
}

const evaluationKind: RecordKind<EvaluationInput> = recordKind(
  evaluation.main,
  {
    evaluators: didListInput,
    summary: l.string(),
    content: contentInput,
    score: l.optional(scoreInput),
  },
  { evaluators: didListTransform, content: contentTransform },
  {
    references: {
      subject: existingRecordReference,
      measurements: references.many(() => measurementKind),
      location: locationReference,
    },
  },
);

/**
 * Creates an Evaluation (`org.hypercerts.context.evaluation`), an assessment of a record such as
 * an Activity, together with the measurements and location it needs, in one atomic write.
 *
 * @remarks
 * The record key is a new TID chosen by the SDK, and `createdAt` defaults to the time of the call.
 *
 * Each `measurements` entry is either a new measurement's fields (see {@link MeasurementInput}),
 * created in the same write together with its own new locations, or `{ uri }` of an existing
 * measurement, which is reused as it is. The two can be mixed. The measurements' own `subjects` are
 * not filled in from the evaluation's `subject`. `location` is a new location's fields or `{ uri }`
 * of an existing one. Nothing is deduplicated, and order is kept.
 *
 * `subject` is `{ uri }` of an existing record of any type; it is pinned by its current CID and
 * never modified, and does not learn about the evaluation. `evaluators` are DIDs stored as given:
 * they are not proof that those accounts wrote or agree with the evaluation, and nobody is
 * notified. `score` takes decimal strings and is checked exactly, without JavaScript numbers:
 * `value` must be from `min` to `max`, inclusive.
 *
 * `content` takes files and links in one array. A `Blob` or `File` is uploaded before the write and
 * needs a `type`; a string is stored as a URL and never fetched.
 *
 * Everything is created in one write: all the records exist afterwards, or none do. An evaluation
 * with no new measurement or location is a write of one record. One write holds at most 200
 * records. The OAuth session needs `create` on the evaluation, measurement and location collections
 * it writes to.
 *
 * Files are uploaded before the write and outside it. If the write fails, they are left unused and
 * the PDS may or may not delete them later. A lexicon rule that rejects the record is found only
 * after the uploads.
 *
 * Not supported: the lexicon's `signatures`.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The evaluation and the records it needs. See {@link EvaluationInput}.
 * @returns The new Evaluation's URI and CID with `created: true`, and the references of its
 * measurements (with their locations) and location. See {@link CreateEvaluationResult}.
 * @throws {@link TypeError} If `input` has an unknown field, an `evaluators` entry that is not a
 * DID, a `score` that is not decimal strings or has a `value` outside `min` to `max`, a mixed or
 * wrongly typed entry (a `measurements` URI that points at another record type, `{ uri }` combined
 * with record fields), more new records than one write holds, or any value the lexicons do not
 * allow. The message names the field. Nothing was written. Blobs may already have been uploaded
 * when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, or
 * an upload fails. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). None of the records
 * was created and nothing needs cleaning up.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS (network
 * failure, timeout, a server error), so the records may or may not exist. It lists every URI that
 * was attempted. The SDK does not retry, because a retry would create duplicates under new keys
 * if the first attempt had succeeded. Check the URIs, then decide.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example An evaluation with a new measurement, an existing one and a score
 * ```ts
 * import { createEvaluation } from "@hypercerts-org/sdk/context";
 *
 * // `context` comes from createSDKContext.
 * const evaluation = await createEvaluation(context, {
 *   evaluators: ["did:plc:abc123"],
 *   summary: "The restoration meets its stated targets.",
 *   subject: { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" },
 *   score: { min: "0", max: "5", value: "4.2" },
 *   content: ["https://example.org/reports/2026-evaluation.pdf"],
 *   measurements: [
 *     { metric: "Forest area restored", unit: "hectares", value: "1234.56" }, // created
 *     { uri: "at://did:plc:abc123/org.hypercerts.context.measurement/3k2a4b5c6d7e8" }, // reused
 *   ],
 * });
 * console.log(evaluation.uri, evaluation.measurements?.[0]); // { uri, cid, created: true }
 * ```
 *
 * @example A score outside its scale is rejected
 * ```ts
 * import { createEvaluation } from "@hypercerts-org/sdk/context";
 *
 * await createEvaluation(context, {
 *   evaluators: ["did:plc:abc123"],
 *   summary: "Strong results.",
 *   score: { min: "0", max: "5", value: "7" }, // TypeError: must have a value from min to max
 * });
 * ```
 */
export const createEvaluation = creatorOf<EvaluationInput, CreateEvaluationResult>(
  "createEvaluation",
  evaluationKind,
);
