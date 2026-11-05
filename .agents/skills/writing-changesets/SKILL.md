---

name: "writing-changesets"
description: "Write short, concise Changesets entries as bullet points. Triggers: \"add a changeset\", \"pnpm changeset\", \"write a changeset\", \"release note\", \".changeset/*.md\"."
version: 1
created: "2026-11-05"
updated: "2026-11-05"
---

## When to Use

Use when a change affects a published package and needs a changeset. Skip for internal refactors, tests, CI, or tooling-only changes.

## Procedure

1. Check which published packages the change touches.
2. Pick the bump: patch for fixes, minor for new features, major for breaking changes (minor while on 0.x).
3. Create .changeset/<short-kebab-name>.md with frontmatter listing each package and bump.
4. Write the body as bullet points, one per user-visible change.
5. Keep each bullet to one line: what changed for the user, not how it was built.
6. Name public symbols, options, env vars or commands in backticks.
7. For breaking changes, add one bullet saying what to change when upgrading.

## Pitfalls

- No prose paragraphs, headings, or recaps.
- No implementation details, file paths, or internal helper names.
- Do not document operations that are not implemented yet.
- Do not bump packages the change does not affect.

## Verification

1. `pnpm changeset status` lists the expected packages and bumps.
2. Every bullet is one line and describes a user-visible change.
