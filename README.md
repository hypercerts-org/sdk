# Hypercerts SDK

TypeScript SDK for reading and writing [Hypercerts](https://hypercerts.org) records on the AT Protocol.

> Work in progress. The package is not published yet.

## Packages

| Package                                 | Description                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@hypercerts-org/sdk`](./packages/sdk) | Read and write Hypercerts records. Operations are grouped by domain through subpath exports. |

The SDK takes an already-authenticated AT Protocol client. Authentication is the application's responsibility; an optional `@hypercerts-org/auth` package is planned. See the [package README](./packages/sdk/README.md) for setup.

## Install

Once published:

```sh
pnpm add @hypercerts-org/sdk @atproto/lex
```

The package is ESM-only and requires Node.js 24 or later.

## Development

Prerequisites:

- Node.js 24 (see `.nvmrc`; also the lowest supported version)
- pnpm 12 (the exact version is pinned in `package.json` under `packageManager`)

```sh
pnpm install
pnpm build
```

| Command                 | What it does                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`            | Build all packages                                                                                                      |
| `pnpm typecheck`        | Type-check all packages                                                                                                 |
| `pnpm test`             | Run the tests with Vitest                                                                                               |
| `pnpm test:e2e`         | Run the end-to-end tests against a PDS in a local sandbox (needs setup, see [End-to-end tests](./docs/e2e-testing.md))  |
| `pnpm lint`             | Lint with Biome                                                                                                         |
| `pnpm format`           | Format files with Biome                                                                                                 |
| `pnpm format:check`     | Check formatting without changing files                                                                                 |
| `pnpm check:package`    | Build, pack and install each package in an isolated project, then check it in Node, TypeScript and a Vite browser build |
| `pnpm check:duplicates` | Check for copied code with jscpd                                                                                        |
| `pnpm changeset`        | Record a change for the next release                                                                                    |

## Releasing

Changes that affect a published package need a changeset (`pnpm changeset`). Packages are versioned independently. Publishing is not automated yet.
