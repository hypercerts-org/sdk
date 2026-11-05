# End-to-end tests

The unit tests in `packages/sdk/src` run against a fake PDS. They cover the failure paths (rejected writes, unknown outcomes, CID mismatches, failed uploads). The end-to-end tests in `packages/sdk/e2e` run the same operations against a real PDS and check what a fake cannot: that the PDS commits the records, reports the CIDs the SDK computed, serves the uploaded blobs, resolves every reference between records, including references to another account's records, and creates none of an Activity's records when one of them fails.

They use an [Atmosphere in a Box](https://tangled.org/kandake.africa/atmosphereinabox) (AiaB) sandbox: a PLC directory, a PDS and a private CA in Docker. The tests sign in with a password through `com.atproto.server.createSession`, as the sandbox accounts have no OAuth client, and give the SDK a `Client` that sends the access token.

## Run them locally

You need Docker with Compose, [Deno](https://deno.com) 2.8.3 (AiaB's command line tool) and a checkout of AiaB at the commit the CI workflow uses (`AIAB_SHA` in [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml)).

Create a sandbox with one PDS and two accounts, start it and seed the accounts. `--subnet auto` picks a free private subnet and works only with native local Linux Docker (AiaB rejects it on Docker Desktop and remote engines). On other setups drop the flag and make sure the default subnet `172.30.249.0/24` is free:

```sh
git clone https://tangled.org/kandake.africa/atmosphereinabox.git ../atmosphereinabox
cd ../atmosphereinabox
git checkout <AIAB_SHA>
deno task install
deno task sandbox create --pds 1 --users-per-pds 2 --project sdk-e2e --subnet auto
deno task sandbox up --build
deno task sandbox seed
```

The sandbox publishes no ports. To reach it from your machine, add its hostnames to your hosts file and start AiaB's loopback relay, which listens on `127.0.0.1:443` (rootless Docker may need `net.ipv4.ip_unprivileged_port_start` lowered to bind it):

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
| `SDK_E2E_USER2`, `SDK_E2E_USER2_PASSWORD` | Handle and password of a second account, whose records the first account's Activity reuses. |
| `NODE_EXTRA_CA_CERTS` (set by the script) | The sandbox's root certificate (`state/ca/root.crt`). Node trusts it for this process only. |

`pnpm test` never runs these tests.

## Things to know

- The tests leave their records and blobs in the two accounts. Each test counts records only around its own call, so earlier runs do not matter. Destroy the sandbox (`deno task sandbox destroy --accept-destructive`) to start clean.
- To reuse another account's record, the SDK finds that account's PDS in the `plc.directory` DID document, and it cannot be pointed at another directory. The sandbox's accounts exist only in its own PLC directory, so `e2e/plc.ts` redirects requests for `https://plc.directory` to `SDK_E2E_PLC_URL` while those tests run.
- One test uploads a 6 MiB file and expects the PDS to refuse it, which relies on the PDS's default upload limit of 5 MiB (`PDS_BLOB_UPLOAD_LIMIT`). Raise that limit in the sandbox and the test fails.
- The test files run one after the other because the tests count the records of the two shared accounts.

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs the same steps on a GitHub-hosted Ubuntu runner: it clones AiaB at the pinned commit, creates and seeds a sandbox, starts the relay, runs `pnpm test:e2e` and destroys the sandbox. It runs on every pull request (again on each push to it) and by hand (`workflow_dispatch`). It does not run on pushes to `main`.

To test against a newer AiaB, change `AIAB_SHA` in the workflow and run it by hand.
