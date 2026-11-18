import type { RecordAlreadyExistsError } from "../errors.js";
import type { StrongRef } from "./resolve-record-ref.js";

/**
 * What the reference PDS answers for a taken key: HTTP 400 `InvalidSwap`. The SDK reports the same
 * values when it finds the record itself before sending anything.
 */
const TAKEN_KEY = { status: 400, code: "InvalidSwap" } as const;

/**
 * Builds the error for a record that already exists at its key. `errorClass` is
 * {@link RecordAlreadyExistsError} or a subclass of it. `details` default to what the PDS answers
 * for a taken key; pass the real ones when a PDS answer is being converted.
 */
export function alreadyExists<E extends RecordAlreadyExistsError>(
  errorClass: new (
    message: string,
    uri: string,
    attempted: readonly StrongRef[],
    details: { status: number; code: string | undefined },
    options?: ErrorOptions,
  ) => E,
  message: string,
  uri: string,
  attempted: readonly StrongRef[],
  details: { status: number; code: string | undefined } = TAKEN_KEY,
  options?: ErrorOptions,
): E {
  return new errorClass(message, uri, attempted, details, options);
}
