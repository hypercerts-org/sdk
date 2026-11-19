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

Create an Activity together with its supporting records in one write:

```ts
import { createActivity } from "@hypercerts-org/sdk/activity";

const { uri, cid } = await createActivity(context, {
  title: "Reforestation in the Phobjikha valley",
  shortDescription: "Planting 5,000 native trees.",
  contributors: [{ identity: { displayName: "Alice" }, details: { inline: "Lead" } }],
});
```

Each domain has a reference with examples, pitfalls and field tables in the [consumer skill](https://github.com/hypercerts-org/sdk/blob/main/.agents/skills/hypercerts-org-sdk/SKILL.md), for example [activities](https://github.com/hypercerts-org/sdk/blob/main/.agents/skills/hypercerts-org-sdk/references/activity.md), [profiles](https://github.com/hypercerts-org/sdk/blob/main/.agents/skills/hypercerts-org-sdk/references/profile.md) and [tags](https://github.com/hypercerts-org/sdk/blob/main/.agents/skills/hypercerts-org-sdk/references/tag.md).

## Write to an organization

Every operation that writes takes an optional last argument `{ repo }`. Leave it out and the record goes to your own repository. Pass an organization's DID and the SDK writes through the [Certified Group Service](https://github.com/hypercerts-org/certified-group-service) (CGS) instead. Tell the context where CGS is, once:

```ts
export const context = createSDKContext({
  client: new Client(session),
  cgs: { url: "https://cgs.example.com", did: "did:web:cgs.example.com" },
});

await createProject(context, input, { repo: orgDid });
```

CGS takes one record per request, so a call that writes several records is not atomic: if it fails part-way it throws `PartialWriteError`, which lists what landed. Writes to an organization also lose the repository-wide `swapCommit` guard. The signed-in account must be a member of the group; CGS checks the role.

The SDK asks your PDS for a service-auth token before each CGS request. With OAuth, add one scope per method to the session (a scope's `lxm` must be a full method name, and its `aud` needs the `#certified_group_service` fragment, written `%23`): `rpc:app.certified.group.repo.createRecord?aud=did:web:cgs.example.com%23certified_group_service`, and the same for `putRecord`, `deleteRecord` and `uploadBlob`. Set `cgs.did` to the DID without the fragment; the SDK adds it.

See the TSDoc on `createSDKContext` (shown in your editor) for the full contract.
