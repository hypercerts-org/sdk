# AGENTS.md

Instructions for coding agents working in this repository. Setup and commands are documented in [README.md](./README.md); do not duplicate them here.

## README.md

`README.md` is the project's front page, not a dumping ground for documentation.

Keep it to what a developer needs to get started:

- what the project is and what it is for
- how to install and use the packages
- how to set up the repository and run the common commands
- where to find further documentation

Put detailed guides, design notes and decision records in dedicated documentation instead (API reference lives in TSDoc, see below), and link to them from the README when useful. Do not append implementation notes, changelogs or long explanations to the README.

## Package boundaries

- `@hypercerts-org/sdk` holds both read and write operations. Group operations by domain (activity, collection, badge, ...) and expose them through subpath exports, not separate read/write packages.
- Create a new package only when a domain has its own setup or dependencies (for example the planned `@hypercerts-org/auth`). `@hypercerts-org/sdk` must not depend on auth helpers; it receives an already-authenticated client.
- Packages are ESM-only. Every public entry point must be listed in the package's `exports` field.
- Keep packages free of import-time side effects so unused operations can be tree-shaken (`sideEffects: false`).
- Helpers shared by several operations usually live in `packages/sdk/src/internal/` and are not exported. Check there, and search the package, before writing a private helper (see below for where shared code goes). `pnpm check:duplicates` (also run in CI) reports copied code, including renamed copies and functions with the same structure. When `check:duplicates` finds a clone, share the code rather than loosening the check.
- Put code where a reader would look for it. Code shared by several domains usually belongs in `internal/`, but use judgement: if it is really one domain's logic that another domain builds on (for example `createActivityInCollection` reusing the activity domain's `prepareActivity`), keep it in its domain and import it from there. Move code when its home stops making sense, not by rule. Avoid circular imports between domains. When `internal/` grows too large to scan, group it into subfolders by concern (for example `internal/records/`, `internal/writes/`) rather than by domain.

## Tooling

- Biome is the only lint and format tool. Do not add ESLint or Prettier.
- The Biome version is pinned exactly. When upgrading it, review changes to the enabled nursery rules (`noFloatingPromises`, `noMisusedPromises`, `useAwaitThenable`).
- Pin dependency versions exactly (`pnpm add -E`).

## API documentation

TSDoc comments on exported symbols are the SDK's API reference. They ship in the published `.d.ts` files, so editors, TypeDoc and coding agents in consumers' repositories read them. Use standard TSDoc and do not duplicate it in separate per-operation docs.

- Every exported function, type and interface gets a TSDoc comment with a one-line summary, plus `@remarks` when there is something the types do not say.
- Functions also document `@param`, `@returns`, `@throws` with the condition that triggers it, and at least one `@example`. Examples import only from public entry points. Values the application provides, such as an auth `session`, may be left undeclared with a comment saying where they come from.
- Use `@remarks` for what a caller cannot tell from the types: what the SDK deliberately does not do, side effects, what is not validated, and the reason for behaviour that looks surprising. Internal comments do not ship, so reasons callers need belong in the public TSDoc.
- Add an `@example` for a likely mistake when there is one.
- Link related symbols with `{@link Name}`. Mark examples that use not-yet-implemented operations as such.
- Keep `docs/` for guides that span several operations.

## Validation

- Validate records with the generated `RecordSchema`s from the `@hypercerts-org/lexicon` package. Never copy, generate or hand-write record schemas in the SDK. Import them from the package's namespace subpaths (for example `@hypercerts-org/lexicon/com/atproto/repo/strongRef`). The package is a peer dependency, like `@atproto/lex`.
- Validate SDK input data (records, URIs, DIDs, option values) with the `l` schema builder from `@atproto/lex` (a peer dependency, so it adds nothing to consumers' bundles). Build input schemas from the record schemas where they overlap. Use its string formats (`did`, `at-uri`, `datetime`, `record-key`, ...) instead of regexes.
- Format checks are not always enough: for example `at-uri` accepts handle authorities and URIs without a record key. Add `l.refine` or a small named check when a card needs a stricter rule.
- Write business rules that span fields or depend on SDK semantics (weight strings, date ranges, MIME and size limits) as `l.refine` or small named checks with specific messages.
- Live objects such as the `Client` are not data; check them with a small duck-typed guard, not a schema.
- Do not add Zod or another validation library.

## Consumer skill

`.agents/skills/hypercerts-org-sdk/` teaches coding agents in consumers' repositories to use the SDK. It follows the [Agent Skills spec](https://agentskills.io/specification): agents load all of `SKILL.md` when the skill activates and read files in `references/` only when a task needs them.

When a change adds or changes a public operation, update the skill in the same PR:

- Each domain (subpath) gets its own `references/<domain>.md` with examples for the common cases and the likely mistakes, pitfalls, and a field table. Do not put a domain's details in `SKILL.md`.
- `SKILL.md` holds only what every domain shares: install, context, imports table, blobs, write errors, general pitfalls and Verify. Add one row per domain to its domain table, and at most a line for a mistake an agent would make before reading the reference.
- Link every reference file from `SKILL.md`. Reference files may link to each other but must not be the only way to reach one.
- Keep `SKILL.md` under 500 lines. List new operations in the `SKILL.md` tables and their reference file, not in the `description` frontmatter. Keep the description general (under the 1024-character limit) so it does not change with each operation.
- Examples import only from public entry points and match the TSDoc. Do not describe operations that are not implemented yet.

## Generated files

- `dist/` and `.turbo/` are build output. Never edit or commit them.
- `pnpm-lock.yaml` is generated by pnpm. Change it only by running pnpm commands.

## Before finishing a change

Run and make sure these pass:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm check:package
pnpm check:duplicates
```

Add a changeset (`pnpm changeset`) for any change that affects a published package. Do not document SDK operations as available until they are implemented.
