# @hypercerts-org/sdk

TypeScript SDK for reading and writing [Hypercerts](https://hypercerts.org) records on the AT Protocol.

> Work in progress. The package is not published yet.

## Install

Once published:

```sh
pnpm add @hypercerts-org/sdk @atproto/lex
```

The package is ESM-only and requires Node.js 24 or later. `@atproto/lex` is a peer dependency: your application owns the client, so the SDK uses your copy.

On pnpm 11 and later, installing `@atproto/lex` fails with `ERR_PNPM_IGNORED_BUILDS` for `core-js`. Add it to `allowBuilds` in your `pnpm-workspace.yaml` (its postinstall script only prints a banner):

```yaml
allowBuilds:
  core-js: false
```

## Set up

The SDK never logs in, refreshes or stores sessions. Authenticate in your application, wrap the session in an `@atproto/lex` `Client`, and create the SDK context once:

```ts
import { Client } from "@atproto/lex";
import { createSDKContext } from "@hypercerts-org/sdk";

// `session` comes from your own auth code, for example an OAuth session.
export const context = createSDKContext({ client: new Client(session) });
```

Every operation takes this context as its first argument. Create a new context when your application switches client, for example after signing in as another account.

```ts
import { uploadBlob } from "@hypercerts-org/sdk/blob";

// `file` is a Blob or File, for example from an <input type="file">.
const image = await uploadBlob(context, file);
```

Operations are imported individually from subpath exports grouped by domain, so the ones you do not import stay out of your bundle.

See the TSDoc on `createSDKContext` (shown in your editor) for the full contract.
