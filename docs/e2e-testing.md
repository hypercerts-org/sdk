# End-to-end tests

The unit tests in `packages/sdk/src` run against a fake PDS. They cover the failure paths (rejected writes, unknown outcomes, CID mismatches, failed uploads). The end-to-end tests in `packages/sdk/e2e` run the same operations against a real PDS and check what a fake cannot: that the PDS commits the records, reports the CIDs the SDK computed, serves the uploaded blobs, resolves every reference between records, including references to another account's records, and creates none of an Activity's records when one of them fails. They also run the writes to an organization (`{ repo: groupDid }`) through a real [Certified Group Service](https://github.com/hypercerts-org/certified-group-service) (CGS), which no fake can show: that CGS accepts the SDK's service-auth tokens, enforces roles, passes a stale `swapRecord` through as `InvalidSwap`, and what is left in the group's repository when a write stops partway.

They use an [Atmosphere in a Box](https://tangled.org/kandake.africa/atmosphereinabox) (AiaB) sandbox: a PLC directory, a PDS, a CGS and a private CA in Docker. The tests sign in with a password through `com.atproto.server.createSession`, as the sandbox accounts have no OAuth client, and give the SDK a `Client` that sends the access token.

## Run them locally

You need Docker with Compose, [Deno](https://deno.com) 2.8.3 (AiaB's command line tool), a checkout of AiaB at the commit the CI workflow uses (`AIAB_SHA` in [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml)) and a checkout of the Certified Group Service at the commit `CGS_SHA` in the same file.

[`scripts/e2e-cgs/install.mjs`](../scripts/e2e-cgs/install.mjs) adds the CGS to the AiaB checkout as the application `cgs` (a service, a route `cgs.<sandbox domain>` and a generated encryption key, from the files next to it) and builds its image from the CGS checkout's committed files. It changes only the AiaB checkout, so use a copy that is yours for this run. Then create a sandbox with one PDS, two accounts and the CGS, start it and seed the accounts. `--subnet auto` picks a free private subnet and works only with native local Linux Docker (AiaB rejects it on Docker Desktop and remote engines). On other setups drop the flag and make sure the default subnet `172.30.249.0/24` is free:

```sh
git clone https://tangled.org/kandake.africa/atmosphereinabox.git ../atmosphereinabox
cd ../atmosphereinabox
git checkout <AIAB_SHA>
git clone https://github.com/hypercerts-org/certified-group-service.git ../certified-group-service
git -C ../certified-group-service checkout <CGS_SHA>
node <this repository>/scripts/e2e-cgs/install.mjs . ../certified-group-service
deno task install
deno task sandbox create --pds 1 --users-per-pds 2 --project sdk-e2e --subnet auto --app cgs
deno task sandbox up --build
deno task sandbox seed
```

The sandbox publishes no ports. To reach it from your machine (the PDS, the PLC directory and the CGS), add its hostnames to your hosts file and start AiaB's loopback relay, which listens on `127.0.0.1:443` (rootless Docker may need `net.ipv4.ip_unprivileged_port_start` lowered to bind it):

```sh
deno task sandbox access hosts | sudo tee -a /etc/hosts
deno task sandbox access start
```

Then, in this repository, export the configuration from the sandbox's state and run the tests:

```sh
eval "$(node scripts/e2e-env.mjs ../atmosphereinabox)"
pnpm test:e2e
```

`scripts/e2e-env.mjs` prints the variables below; do not run it without `eval`, because the output contains the accounts' passwords. Without them, `pnpm test:e2e` fails and names the ones that are missing. It never skips.

| Variable                                  | Meaning                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SDK_E2E_PDS_URL`                         | Origin of the PDS, for example `https://pds1.atmosbox.test`.                                |
| `SDK_E2E_PLC_URL`                         | Origin of the sandbox's PLC directory, for example `https://plc.atmosbox.test`.             |
| `SDK_E2E_USER1`, `SDK_E2E_USER1_PASSWORD` | Handle and password of the account that creates records.                                    |
| `SDK_E2E_USER2`, `SDK_E2E_USER2_PASSWORD` | Handle and password of a second account, whose records the first account's tests use.       |
| `SDK_E2E_CGS_URL`                         | Origin of the Certified Group Service, for example `https://cgs.atmosbox.test`.             |
| `SDK_E2E_CGS_DID`                         | The service's DID, `did:web:` and its host name, without the `#certified_group_service`.    |
| `NODE_EXTRA_CA_CERTS` (set by the script) | The sandbox's root certificate (`state/ca/root.crt`). Node trusts it for this process only. |

`pnpm test` never runs these tests.

### Without the relay (rootless Docker, no root)

If you cannot bind port 443 or edit `/etc/hosts`, run the tests inside a container (Linux hosts only: the script mounts your own Node binary into a Linux container, so it does not work with Docker Desktop on macOS or Windows) on the sandbox's own Docker network instead. [`scripts/e2e-docker.sh`](../scripts/e2e-docker.sh) does that, with your Node and this repository mounted, and passes the same variables (the passwords by name, not on the command line). Pass Vitest arguments after the checkout to select files:

```sh
scripts/e2e-docker.sh ../atmosphereinabox            # everything
scripts/e2e-docker.sh ../atmosphereinabox org-writes # one file
```

With rootless Docker, AiaB's `seed` step also fails to read its private state (`EACCES` on `/state/manifest.json`), because the runner service is generated with your UID, which rootless Docker maps to another host UID. Change the runner's `user: <your UID>:<your GID>` line (for example `user: 1000:1000`) of the generated `compose.yaml` in your own copy of the AiaB checkout to `user: 0:0` (container root is your user there) before `deno task sandbox seed`. Do not loosen the permissions of `state/`. This is not needed on the CI runner or with rootful Docker.

## Things to know

- **`org-writes.e2e.test.ts` runs the organization writes through the real CGS.** Each test registers its own group (`app.certified.group.register`, called with a service-auth token as any application would) with `user1` as owner and adds `user2` as a `member`. CGS creates the group's account on the sandbox PDS, so its records are read back from there. What it covers: the records of `createProject` land in the group's repository, one request each, with the CIDs the SDK computed; `addActivityToProject` and `addActivityToCollection` with `activity: { uri }` send one `putRecord` with `swapRecord`; a change to the Collection between the SDK's read and its write comes back as `WriteRejectedError` with `code` `InvalidSwap`; a member who replaces another member's Collection gets `WriteRejectedError` with `status` 403 (and the same call works once the owner makes them `admin`); the token's `aud` is `<cgs did>#certified_group_service` with the method as `lxm`; with a context that holds only an API key (`cgs.auth`, no client), a member mints the key (`keys.create` over service auth, a helper in `e2e/group.ts`, not public API) and creates records in the group, and the denials come back as `WriteRejectedError` 401 (revoked key, another group) or 403 (missing `repo:` or `blob:` scope, the member's role), partial writes included, with the secret in no message and CGS refuses a token whose `aud` is another service. The register call is the exception: it is a service-level method, so its token's `aud` is the bare DID.
- **How the partial write is forced.** `createProject` with a location and a tag sends at least four `createRecord` requests. The test takes the key of the third just before it is sent, by having the owner create a record there through CGS (the SDK has made its plan and holds a token, so the key was free when it planned). CGS then refuses the SDK's create, the SDK reads the key back, sees another record's CID and reports `RecordAlreadyExistsError` as the `failure` of a `PartialWriteError` whose `written` are the first two records and whose `notAttempted` are the rest. The test checks that the first two exist, the third key holds the owner's record, and the rest do not exist. The same trick (acting from `before` in `watchCgs`) makes the stale `swapRecord`.
- The sandbox's PLC directory is the only one that knows the group's account, so `org-writes.e2e.test.ts` redirects `https://plc.directory` to it, like the tests that reuse another account's record (below).
- Most tests leave their records and blobs in the two accounts (the social tests delete theirs). Each test counts records only around its own call, so earlier runs do not matter. Destroy the sandbox (`deno task sandbox destroy --accept-destructive`) to start clean.
- An account has one profile, so the `createProfile` tests delete the first account's profile (the `self` record) before each test.
- A vocabulary tag's key is chosen by the caller and cannot be reused, so the tag tests give every tag a key that is different on every run.
- To reuse another account's record, the SDK finds that account's PDS in the `plc.directory` DID document, and its default DID resolver cannot be pointed at another directory (an application can pass its own `didResolver`). The sandbox's accounts exist only in its own PLC directory, so `e2e/plc.ts` redirects requests for `https://plc.directory` to `SDK_E2E_PLC_URL` while those tests run.
- One test uploads a 6 MiB file and expects the PDS to refuse it, which relies on the PDS's default upload limit of 5 MiB (`PDS_BLOB_UPLOAD_LIMIT`). Raise that limit in the sandbox and the test fails.
- The test files run one after the other because the tests count the records of the two shared accounts.

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs the same steps on a GitHub-hosted Ubuntu runner: it clones AiaB and the CGS at their pinned commits, adds the CGS to AiaB, creates and seeds a sandbox, starts the relay, runs `pnpm test:e2e` and destroys the sandbox. It runs on every pull request (again on each push to it) and by hand (`workflow_dispatch`). It does not run on pushes to `main`.

The CGS image is built on the runner (about three minutes). To test against a newer AiaB or CGS, change `AIAB_SHA` or `CGS_SHA` in the workflow and run it by hand.
