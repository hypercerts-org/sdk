# How writes to an organization work

Every write operation takes an optional `{ repo }`. This guide shows where a write goes and what happens when it fails. Setup, scopes and API keys are in the [package README](../packages/sdk/README.md#write-to-an-organization).

## Overview

Who talks to whom, for a signed-in user and for a server with an API key:

```mermaid
flowchart LR
  subgraph App["Your app / server"]
    U["Signed-in user<br/>(OAuth session)"]
    D["Server / daemon<br/>(no user)"]
  end
  subgraph SDK["Hypercerts SDK"]
    W["Write functions<br/>createProject, addActivity..."]
    T{"Which target?"}
  end
  subgraph Own["User's own PDS"]
    P[(User repo)]
    SA["getServiceAuth<br/>(issues 1-call pass)"]
  end
  subgraph CGS["Certified Group Service"]
    C["checks pass or API key<br/>+ member role + key scopes"]
  end
  subgraph Org["Org's PDS"]
    O[(Org repo)]
  end
  U --> W
  D --> W
  W --> T
  T -->|"session, no { repo } or your own DID"| P
  T -->|"{ repo: org } + session"| SA
  SA -->|"Bearer token"| C
  T -->|"{ repo: org } + API key<br/>X-API-Key"| C
  C --> O
  W -.->|"reads: head, key taken?, read-back<br/>(no login)"| O
```

## Which target

The SDK picks the target before it validates the input, so a missing `{ repo }` or `cgs` fails first. Not shown: a client with no session throws `Error`, and a `repo` that is not a DID throws `TypeError`.

```mermaid
flowchart TB
  A["createProject(ctx, input, { repo? })"] --> Q1{"Using an API key?"}
  Q1 -->|yes, no repo| X1["TypeError: pass { repo: orgDid }"]
  Q1 -->|yes, repo given| CGS["cgsTarget<br/>signs with API key"]
  Q1 -->|no| Q2{"repo missing or your own DID?"}
  Q2 -->|yes| PDS["pdsTarget<br/>user's own PDS"]
  Q2 -->|"no, ctx.cgs missing"| X2["TypeError: CGS not configured"]
  Q2 -->|no| CGS2["cgsTarget<br/>signs with service auth"]
  PDS & CGS & CGS2 --> V["validate input · prepareRecord<br/>pick rkey · compute CID"]
  V -->|invalid| VX["TypeError, cause LexValidationError<br/>(nothing sent)"]
```

## How each target sends the plan

The PDS can commit a plan at once; CGS takes one record per request:

```mermaid
flowchart TB
  P["WritePlan<br/>creates · updates · createOnly · swapCommit"] --> T{"target"}
  T -->|pdsTarget| PS{"what kind of plan?"}
  PS -->|create-only| P1["putRecord, only if absent"]
  PS -->|one checked update| P2["putRecord + swapRecord"]
  PS -->|anything else| P3["applyWrites - all or nothing"]
  T -->|cgsTarget| L["for each record, in order<br/>creates, then updates"]
  L --> SIGN{"how to sign?"}
  SIGN -->|service auth| S1["ask own PDS for a one-call token"]
  SIGN -->|API key| S2["X-API-Key header"]
  S1 & S2 --> SEND["POST to CGS ?repo=<br/>createRecord / putRecord"]
  SEND -->|ok, more left| L
  SEND -->|ok, last one| DONE["done"]
```

## When a CGS write fails

What the caller sees depends on the answer and on whether earlier records already landed. A failed service-auth token request also counts as a failed step:

```mermaid
flowchart TB
  F["CGS answers with an error"] --> K{"which error?"}
  K -->|"no usable answer<br/>(5xx, 408, network) on a create"| RB["read the record back<br/>same CID: treat as ok<br/>different: RecordAlreadyExistsError<br/>none: WriteOutcomeUnknownError"]
  K -->|"403 on a delete"| RD["read the record back<br/>gone: treat as ok<br/>else: WriteRejectedError"]
  K -->|"400 InvalidSwap<br/>on a checked update"| E1["WriteRejectedError<br/>(the record changed since it was read)"]
  K -->|"401 / 403"| E2["WriteRejectedError<br/>(API key: names it as cgsk_ref, never the secret)"]
  E1 & E2 --> Q{"did any earlier<br/>record already land?"}
  RB -->|"error"| Q
  Q -->|no| T1["throw that error"]
  Q -->|yes| T2["PartialWriteError<br/>written · failed · notAttempted"]
```

## Using service auth and an API key together

The credential belongs to the context, not to the call, and there is no per-call option to change it. To use both, create two contexts and pass the one that fits each call:

```ts
import { Client } from "@atproto/lex";
import { createSDKContext } from "@hypercerts-org/sdk";
import { createProject } from "@hypercerts-org/sdk/project";

const cgs = { url: "https://cgs.example.com", did: "did:web:cgs.example.com" };

// Acts as the signed-in user. `session` comes from your own auth code.
const userContext = createSDKContext({ client: new Client(session), cgs });

// Acts as the member who minted the key. No user.
const keyContext = createSDKContext({
  cgs: { ...cgs, auth: { kind: "apiKey", key: process.env.CGS_API_KEY! } },
});

await createProject(userContext, input, { repo: groupDid }); // service auth
await createProject(keyContext, input, { repo: groupDid }); // API key
```

Two catches:

- A key context has no user, so a personal write (no `{ repo }`) throws `TypeError`. It never falls back to a PDS.
- A write through the key is recorded in CGS's audit log as the member who created the key, with the key's `cgsk_<ref>`, not as whoever's code made the call. The SDK does not control this; it is CGS's behaviour.
