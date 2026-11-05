// Prints the environment variables the end-to-end tests need (see docs/e2e-testing.md), read
// from the state of a created and seeded Atmosphere in a Box sandbox.
//
//   eval "$(node scripts/e2e-env.mjs ../atmosphereinabox)"   exports them into the current shell
//   node scripts/e2e-env.mjs "$AIAB_DIR" --github-env "$GITHUB_ENV"
//                                                            appends them to that file in a GitHub
//                                                            Actions job and masks the passwords in
//                                                            its log
//
// The output contains the accounts' passwords: do not run it without `eval` or `--github-env`.

import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const usage =
  "usage: node scripts/e2e-env.mjs <path to the Atmosphere in a Box checkout> [--github-env <file>]";
const [checkout, flag, githubEnv, ...extra] = process.argv.slice(2);
const validFlag = flag === undefined || (flag === "--github-env" && githubEnv);
if (!checkout || !validFlag || extra.length > 0) fail(usage);

const state = join(resolve(checkout), "state");
const manifest = readState("manifest.json");
const accounts = readState("accounts.json").accounts ?? {};
const pds = manifest.pds?.[0];
const [user1, user2] = pds?.users ?? [];
if (!user1 || !user2) {
  fail(
    "the sandbox needs two accounts on its first PDS. Create it with `--users-per-pds 2`; see docs/e2e-testing.md.",
  );
}

const variables = {
  SDK_E2E_PDS_URL: pds.url,
  SDK_E2E_PLC_URL: manifest.plc,
  SDK_E2E_USER1: user1.handle,
  SDK_E2E_USER1_PASSWORD: passwordOf(user1.handle),
  SDK_E2E_USER2: user2.handle,
  SDK_E2E_USER2_PASSWORD: passwordOf(user2.handle),
  // Node trusts the sandbox's CA for this process only; nothing is installed system-wide.
  NODE_EXTRA_CA_CERTS: join(state, "ca", "root.crt"),
};

if (githubEnv) {
  for (const name of ["SDK_E2E_USER1_PASSWORD", "SDK_E2E_USER2_PASSWORD"]) {
    console.log(`::add-mask::${variables[name]}`);
  }
  appendFileSync(
    githubEnv,
    Object.entries(variables)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
} else {
  for (const [name, value] of Object.entries(variables)) {
    console.log(`export ${name}='${value.replaceAll("'", "'\\''")}'`);
  }
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(join(state, file), "utf8"));
  } catch (error) {
    return fail(
      `cannot read ${join(state, file)} (${error.message}). Is that an Atmosphere in a Box checkout whose sandbox was created and seeded?`,
    );
  }
}

function passwordOf(handle) {
  const password = accounts[handle]?.password;
  return (
    password ??
    fail(`${handle} has no password in accounts.json. Run \`deno task sandbox seed\` first.`)
  );
}

function fail(message) {
  console.error(`e2e-env: ${message}`);
  process.exit(1);
}
