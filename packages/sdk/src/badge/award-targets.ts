import { type DidString, l } from "@atproto/lex";
import * as definition from "@hypercerts-org/lexicon/app/certified/badge/definition";
import * as certifiedDefs from "@hypercerts-org/lexicon/app/certified/defs";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import { type BuildContext, parseInput } from "../internal/build-context.js";
import { describeError, describeValue } from "../internal/describe.js";
import { strictObject } from "../internal/input.js";
import type { PreparedRecord } from "../internal/prepare-record.js";
import { buildRecord } from "../internal/record-kind.js";
import { parseRecordUri, readRecord, type StrongRef } from "../internal/resolve-record-ref.js";
import { isInputObject, toSlot } from "../internal/slots.js";
import { type BadgeDefinitionInput, badgeDefinitionKind } from "./build-definition.js";

// What an award points at: the subject it is for and the badge definition it uses.

export type DefinitionPlan =
  | { kind: "existing"; uri: string }
  | { kind: "new"; input: BadgeDefinitionInput };

// Reads the caller's choice and, for a new definition, checks the signed-in account against its
// issuers, so a denied award fails before anything is read or uploaded.
export function planDefinition(build: BuildContext, value: unknown): DefinitionPlan {
  // `toSlot` reads the choice as every other operation does: `{ uri }` reuses an existing record, a
  // record's fields create one. It rejects a mix of both and a URI of another type of record.
  const { choice } = toSlot(build, "definition", value, badgeDefinitionKind, false);
  if (choice.kind === "existing") {
    parseRecordUri(choice.uri, build.operation);
    return { kind: "existing", uri: choice.uri };
  }
  const input = parseInput(build, "definition", badgeDefinitionKind.input, value);
  assertIssuerAllowed(build, "the new badge definition", input.allowedIssuers);
  return { kind: "new", input };
}

// An omitted list lets anyone issue the badge; an empty one lets no one.
function assertIssuerAllowed(
  build: BuildContext,
  which: string,
  allowedIssuers: readonly string[] | undefined,
): void {
  if (allowedIssuers === undefined || allowedIssuers.includes(build.did)) return;
  const reason =
    allowedIssuers.length === 0
      ? "lists no allowed issuers, so no one can award it"
      : `lets only ${allowedIssuers.join(", ")} award it`;
  throw new Error(
    `${build.operation}: ${which} ${reason}, but the client is signed in as ${build.did}. No record was written. Award a badge whose definition allows this account, or leave allowedIssuers out of the definition to let anyone award it.`,
  );
}

export interface ResolvedDefinition {
  readonly ref: StrongRef;
  /** The record to write with the award, when the definition is new. */
  readonly created: PreparedRecord | undefined;
}

// An existing definition is read and checked as it is now, and the award pins that version. A new
// one is built by the same kind `createBadgeDefinition` uses, with its icon uploaded, but not written.
export async function resolveDefinition(
  build: BuildContext,
  plan: DefinitionPlan,
): Promise<ResolvedDefinition> {
  if (plan.kind === "new") {
    const created = await buildRecord(badgeDefinitionKind, build, plan.input, "definition");
    return { ref: created.ref, created };
  }
  const stored = await readRecord(build.context, plan.uri, build.operation);
  const checked = definition.main.safeValidate(stored.value);
  if (!checked.success) {
    throw new Error(
      `${build.operation}: the badge definition ${plan.uri} is not a valid ${definition.main.$type} record (${describeError(checked.reason)}), so it cannot be awarded. No record was written.`,
      { cause: checked.reason },
    );
  }
  assertIssuerAllowed(
    build,
    `the badge definition ${plan.uri}`,
    checked.value.allowedIssuers?.map(({ did }) => did),
  );
  return { ref: stored.ref, created: undefined };
}

const accountSubject = strictObject({ did: l.string({ format: "did" }) });
const recordSubject = strictObject({ uri: l.string() });

export function parseSubject(
  build: BuildContext,
  value: unknown,
): { did: DidString } | { uri: string } {
  if (isInputObject(value) && "did" in value) {
    return parseInput(build, "subject", accountSubject, value);
  }
  if (isInputObject(value) && "uri" in value) {
    const subject = parseInput(build, "subject", recordSubject, value);
    parseRecordUri(subject.uri, build.operation);
    return subject;
  }
  throw new TypeError(
    `${build.operation}: subject must be { did } for an account or { uri } for a record, but received ${describeValue(value)}.`,
  );
}

// An account is stored as the lexicon's DID object, a record as a strong reference to the version
// that was read, which pins what the award was made for.
export async function resolveSubject(
  build: BuildContext,
  subject: { did: DidString } | { uri: string },
) {
  if ("did" in subject) return certifiedDefs.did.build({ did: subject.did });
  const { ref } = await readRecord(build.context, subject.uri, build.operation);
  return strongRef.main.build(ref);
}
